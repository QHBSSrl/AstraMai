import 'dart:convert';
import 'dart:math';

import 'package:crypto/crypto.dart';
import 'package:http/http.dart' as http;

import 'oidc_config.dart';

/// OIDC 客户端（Authorization Code + PKCE）。
///
/// ── 为什么是 PKCE 而不是别的流程 ────────────────────────────────────
///
/// 移动端是**公开客户端**：没有安全的地方存 secret，任何打进 APK 的
/// 东西都能被 reverse 出来。
///
/// 所以标准做法是 PKCE —— 每次登录生成一个一次性的 `code_verifier`，
/// 用它的 SHA-256 去做授权，换 token 时再把原值带上。
/// 这样即使有人截到 `code`，没有 verifier 也换不出 token。
///
/// Implicit 流程不能用（token 直接出现在 URL 里，会被日志/历史记录留下）。
///
/// ── 这个类只做协议，不管 UI ────────────────────────────────────────
///
/// 打开浏览器那一步交给调用方（`flutter_web_auth_2`），这里只负责：
/// 拼 URL、派生 PKCE、换 token、解析 JWT、判断角色。
class OidcClient {
  OidcClient({required this.httpClient});

  final http.Client httpClient;

  static const Duration _timeout = Duration(seconds: 20);

  /// 生成一次登录需要的 PKCE 参数。
  PkcePair generatePkce() {
    final random = Random.secure();
    const chars =
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
    final verifier = List.generate(64, (_) => chars[random.nextInt(chars.length)])
        .join();

    final digest = sha256.convert(ascii.encode(verifier)).bytes;
    final challenge = base64Url.encode(digest).replaceAll('=', '');

    return PkcePair(verifier: verifier, challenge: challenge);
  }

  /// 拼授权页 URL。
  String buildAuthorizeUrl({
    required PkcePair pkce,
    required String state,
  }) {
    final params = {
      'client_id': OidcConfig.clientId,
      'response_type': 'code',
      'redirect_uri': OidcConfig.redirectUri,
      'scope': OidcConfig.scope,
      'state': state,
      'code_challenge': pkce.challenge,
      'code_challenge_method': 'S256',
    };

    final query = params.entries
        .map((e) =>
            '${Uri.encodeComponent(e.key)}=${Uri.encodeComponent(e.value)}')
        .join('&');

    return '${OidcConfig.authorizationEndpoint}?$query';
  }

  /// 生成一个随机的 `state`，用来防 CSRF。
  ///
  /// 回调回来时必须和发出去的一致 —— 不然可能是别人构造的链接。
  String generateState() {
    final random = Random.secure();
    return List.generate(24, (_) => random.nextInt(16).toRadixString(16)).join();
  }

  /// 用 authorization code 换 token。
  Future<AuthTokens> exchangeCode({
    required String code,
    required String verifier,
  }) async {
    final body = <String, String>{
      'grant_type': 'authorization_code',
      'client_id': OidcConfig.clientId,
      'code': code,
      'redirect_uri': OidcConfig.redirectUri,
      'code_verifier': verifier,
    };

    // 默认不带 secret（正确的公开客户端做法）。
    // 如果 Casdoor 那边强制校验，把 OidcConfig.useClientSecret 打开。
    if (OidcConfig.useClientSecret) {
      body['client_secret'] = OidcConfig.clientSecret;
    }

    return _postToken(body);
  }

  /// 用 refresh token 换新的 access token。
  ///
  /// Casdoor 开了轮换，所以每次都会返回**新的** refresh token，
  /// 调用方必须把两个都存下来 —— 只存 access token 会导致下次刷新失败。
  Future<AuthTokens> refresh(String refreshToken) async {
    final body = <String, String>{
      'grant_type': 'refresh_token',
      'client_id': OidcConfig.clientId,
      'refresh_token': refreshToken,
    };

    if (OidcConfig.useClientSecret) {
      body['client_secret'] = OidcConfig.clientSecret;
    }

    return _postToken(body);
  }

  Future<AuthTokens> _postToken(Map<String, String> body) async {
    final response = await httpClient
        .post(
          Uri.parse(OidcConfig.tokenEndpoint),
          headers: {'content-type': 'application/x-www-form-urlencoded'},
          body: body,
        )
        .timeout(_timeout);

    Map<String, Object?>? json;
    try {
      final decoded = jsonDecode(utf8.decode(response.bodyBytes));
      if (decoded is Map<String, Object?>) json = decoded;
    } on FormatException {
      throw OidcException(
        'token 端点返回了非 JSON（HTTP ${response.statusCode}）',
        status: response.statusCode,
      );
    }

    if (json == null || response.statusCode >= 400) {
      final error = json?['error'] as String? ??
          json?['msg'] as String? ??
          '换 token 失败（HTTP ${response.statusCode}）';
      throw OidcException(error, status: response.statusCode);
    }

    final accessToken = json['access_token'] as String?;
    if (accessToken == null || accessToken.isEmpty) {
      throw const OidcException('服务器没返回 access_token');
    }

    final expiresIn = (json['expires_in'] as num?)?.toInt() ?? 7200;

    return AuthTokens(
      accessToken: accessToken,
      refreshToken: json['refresh_token'] as String?,
      idToken: json['id_token'] as String?,
      expiresAt: DateTime.now().add(Duration(seconds: expiresIn)),
      claims: decodeJwt(accessToken),
    );
  }

  /// 解析 JWT 的 payload（**不验签**）。
  ///
  /// ── 为什么不验签 ──────────────────────────────────────────────────
  ///
  /// 这个 token 是**我们自己刚刚从 HTTPS 的 token 端点拿到的**，
  /// 不是别人给的。传输层已经保证了来源可信，再验签是多余的。
  ///
  /// ⚠️ **但如果以后 token 从别的地方来（比如本地缓存被改过），
  /// 就必须验签。** 缓存的内容应该视为不可信 —— 所以 [AuthStore]
  /// 读缓存之后要检查 `exp`，过期的直接丢弃。
  static Map<String, Object?> decodeJwt(String token) {
    final parts = token.split('.');
    if (parts.length < 2) {
      throw const OidcException('token 不是 JWT 格式');
    }

    try {
      final normalized = base64Url.normalize(parts[1]);
      final decoded = utf8.decode(base64Url.decode(normalized));
      final json = jsonDecode(decoded);
      if (json is! Map<String, Object?>) {
        throw const OidcException('JWT payload 不是对象');
      }
      return json;
    } on FormatException {
      throw const OidcException('JWT payload 解不开');
    }
  }

  /// 从 claims 里取出用户名。
  String displayName(Map<String, Object?> claims) {
    for (final key in ['name', 'displayName', 'preferred_username', 'email']) {
      final value = claims[key];
      if (value is String && value.trim().isNotEmpty) return value;
    }
    return '未知用户';
  }

  /// 从 claims 里取邮箱。
  String? email(Map<String, Object?> claims) {
    final value = claims['email'];
    return value is String && value.isNotEmpty ? value : null;
  }

  /// 判断是不是 Plus。
  ///
  /// ⚠️ **`roles` 是对象数组，不是字符串数组。**
  ///
  /// Casdoor 给的形状是：
  ///
  /// ```json
  /// "roles": [{"name": "plus", "displayName": "AstraMai Plus", ...}]
  /// ```
  ///
  /// 所以 `roles.contains('plus')` 永远返回 false —— 这是个很容易踩的坑，
  /// 而且不会报错，只是所有人都不是 Plus。
  static bool isPlus(Map<String, Object?> claims) {
    final roles = claims['roles'];
    if (roles is! List) return false;

    for (final role in roles) {
      if (role is Map && role['name'] == OidcConfig.plusRole) return true;
      // 兜底：某些配置下可能只给字符串
      if (role is String && role == OidcConfig.plusRole) return true;
    }
    return false;
  }

  /// 整个 token 是不是还有效（留 60 秒余量）。
  static bool isExpired(Map<String, Object?> claims) {
    final exp = claims['exp'];
    if (exp is! num) return true;
    final expiresAt = DateTime.fromMillisecondsSinceEpoch(exp.toInt() * 1000);
    return expiresAt.isBefore(DateTime.now().add(const Duration(seconds: 60)));
  }
}

/// 一次 PKCE 的两个值。
class PkcePair {
  const PkcePair({required this.verifier, required this.challenge});

  final String verifier;
  final String challenge;
}

/// 登录拿到的 token 集合。
class AuthTokens {
  const AuthTokens({
    required this.accessToken,
    required this.expiresAt,
    required this.claims,
    this.refreshToken,
    this.idToken,
  });

  final String accessToken;
  final String? refreshToken;
  final String? idToken;
  final DateTime expiresAt;
  final Map<String, Object?> claims;

  Map<String, Object?> toJson() => {
        'access_token': accessToken,
        'refresh_token': refreshToken,
        'id_token': idToken,
        'expires_at': expiresAt.toIso8601String(),
      };

  factory AuthTokens.fromJson(Map<String, Object?> json) => AuthTokens(
        accessToken: json['access_token'] as String? ?? '',
        refreshToken: json['refresh_token'] as String?,
        idToken: json['id_token'] as String?,
        expiresAt: DateTime.tryParse(json['expires_at'] as String? ?? '') ??
            DateTime.fromMillisecondsSinceEpoch(0),
        claims: OidcClient.decodeJwt(json['access_token'] as String? ?? ''),
      );
}

/// 登录相关的错误。
class OidcException implements Exception {
  const OidcException(this.message, {this.status = 0});

  final String message;
  final int status;

  /// 是不是「需要重新登录」。
  bool get needsLogin =>
      status == 401 || status == 403 || message.contains('invalid_grant');

  @override
  String toString() => message;
}
