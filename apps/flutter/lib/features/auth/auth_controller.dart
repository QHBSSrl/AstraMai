import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_web_auth_2/flutter_web_auth_2.dart';
import 'package:http/http.dart' as http;

import '../../core/oidc_client.dart';
import '../../core/oidc_config.dart';
import '../../data/auth_store.dart';

/// 登录状态。
///
/// ── 登录流程 ────────────────────────────────────────────────────────
///
/// ```
/// 1. 生成 PKCE verifier + challenge，生成 state
/// 2. 打开系统浏览器到 Casdoor 授权页
/// 3. 用户在浏览器里登录（可能已经登录过，直接就过）
/// 4. Casdoor 重定向到 astramai://callback?code=xxx&state=xxx
/// 5. 校验 state，用 code + verifier 换 token
/// 6. 解析 JWT，读 roles，判断是不是 Plus
/// ```
///
/// **为什么必须用系统浏览器而不是 WebView：**
/// Casdoor（以及绝大多数 OIDC 提供方）会检测 WebView 并拒绝。
/// 而且用户更信任系统浏览器 —— 能确认地址栏是真的。
///
/// ── 这个类不 import material ────────────────────────────────────────
///
/// 三端 UI 共用登录逻辑。iOS 那边换成 Cupertino 的登录页也不用改这里。
class AuthController extends ChangeNotifier {
  AuthController({AuthStore? store, OidcClient? client})
      : _store = store ?? AuthStore(),
        _client = client ?? OidcClient(httpClient: http.Client());

  final AuthStore _store;
  final OidcClient _client;

  AuthTokens? _tokens;
  AuthTokens? get tokens => _tokens;

  bool _busy = false;
  bool get busy => _busy;

  String? _error;
  String? get error => _error;

  bool _ready = false;
  bool get ready => _ready;

  /// 有没有登录。
  bool get signedIn => _tokens != null;

  /// 用户名。
  String get displayName => _tokens == null
      ? ''
      : _client.displayName(_tokens!.claims);

  /// 邮箱。
  String? get email =>
      _tokens == null ? null : _client.email(_tokens!.claims);

  /// 是不是 Plus。
  ///
  /// 我们现在的策略是「注册即 Plus」，所以登录用户基本都是 true。
  /// 但**代码里不要假设它一定为 true** —— 以后要收费时会有一部分人为 false。
  bool get isPlus =>
      _tokens != null && OidcClient.isPlus(_tokens!.claims);

  /// 启动时恢复登录态。
  Future<void> restore() async {
    _tokens = await _store.read();
    _ready = true;
    notifyListeners();

    // 缓存的 token 快过期了就在后台续一下
    if (_tokens != null) {
      final exp = _tokens!.claims['exp'];
      if (exp is num) {
        final expiresAt =
            DateTime.fromMillisecondsSinceEpoch(exp.toInt() * 1000);
        // 剩不到 15 分钟就续期
        if (expiresAt.difference(DateTime.now()).inMinutes < 15) {
          unawaited(_refreshQuietly());
        }
      }
    }
  }

  /// 走一遍完整的登录。
  Future<bool> signIn() async {
    if (_busy) return false;

    _busy = true;
    _error = null;
    notifyListeners();

    try {
      final pkce = _client.generatePkce();
      final state = _client.generateState();

      final resultUrl = await FlutterWebAuth2.authenticate(
        url: _client.buildAuthorizeUrl(pkce: pkce, state: state),
        callbackUrlScheme: OidcConfig.callbackScheme,
        options: const FlutterWebAuth2Options(
          // 用 ephemeral session 还是共享 cookie？
          // 共享 cookie 能做到「一次登录，以后直接过」——
          // 这正是用户想要的，所以用默认的共享会话。
          preferEphemeral: false,
        ),
      );

      // ignore: avoid_print
      print('[AstraMai] 收到回调: $resultUrl');

      final uri = Uri.parse(resultUrl);

      // 用户可能在授权页点了取消
      final error = uri.queryParameters['error'];
      if (error != null) {
        throw OidcException(
          uri.queryParameters['error_description'] ?? error,
        );
      }

      // 防 CSRF —— state 对不上就拒绝
      final returnedState = uri.queryParameters['state'];
      if (returnedState != state) {
        throw const OidcException('登录校验失败（state 不匹配）');
      }

      final code = uri.queryParameters['code'];
      // ignore: avoid_print
      print('[AstraMai] code 有=${code != null && code.isNotEmpty}');
      if (code == null || code.isEmpty) {
        throw const OidcException('授权页没返回 code');
      }

      final tokens = await _client.exchangeCode(
        code: code,
        verifier: pkce.verifier,
      );

      // ignore: avoid_print
      print('[AstraMai] 换 token 成功, roles=${tokens.claims['roles']}');

      _tokens = tokens;
      await _store.write(tokens);

      _busy = false;
      notifyListeners();
      return true;
    } on OidcException catch (e) {
      // ignore: avoid_print
      print('[AstraMai] 登录失败: ${e.message} (status=${e.status})');
      _error = e.message;
    } catch (e) {
      // flutter_web_auth_2 在用户取消时抛 PlatformException，message 是 'CANCELED'
      // ignore: avoid_print
      print('[AstraMai] 登录异常（非 OidcException）: $e');
      final text = e.toString();
      if (text.contains('CANCELED') || text.contains('canceled')) {
        _error = null; // 用户主动取消，不算错误
      } else {
        _error = '登录失败：$e';
      }
    }

    _busy = false;
    notifyListeners();
    return false;
  }

  /// 退出登录。
  ///
  /// 只清本地 —— **不调 Casdoor 的 logout 端点**。
  ///
  /// 理由：那会把浏览器里的会话也退掉，用户下次登录要重新输密码。
  /// 「退出 App」和「退出浏览器会话」是两件事，不该绑在一起。
  Future<void> signOut() async {
    _tokens = null;
    _error = null;
    await _store.clear();
    notifyListeners();
  }

  /// 清掉错误提示。
  void clearError() {
    if (_error == null) return;
    _error = null;
    notifyListeners();
  }

  /// 静默续期。
  ///
  /// ⚠️ **Casdoor 开了 refresh token 轮换**，所以每次续期都会拿到新的
  /// refresh token —— 必须把两个都存下来，否则下次续期会失败。
  Future<void> _refreshQuietly() async {
    final current = _tokens;
    if (current?.refreshToken == null) return;

    try {
      final refreshed = await _client.refresh(current!.refreshToken!);
      _tokens = refreshed;
      await _store.write(refreshed);
      notifyListeners();
    } catch (_) {
      // 续不上就当作登录过期，不要弹错误打断用户
      _tokens = null;
      await _store.clear();
      notifyListeners();
    }
  }

  /// 公用的 refresh，给 API 层在收到 401 时调。
  ///
  /// 返回 true 表示续期成功，调用方可以重试。
  Future<bool> refresh() async {
    final current = _tokens;
    if (current?.refreshToken == null) return false;

    try {
      final refreshed = await _client.refresh(current!.refreshToken!);
      _tokens = refreshed;
      await _store.write(refreshed);
      notifyListeners();
      return true;
    } on OidcException catch (e) {
      if (e.needsLogin) {
        _tokens = null;
        await _store.clear();
        notifyListeners();
      }
      return false;
    } catch (_) {
      return false;
    }
  }

  @override
  void dispose() {
    _client.httpClient.close();
    super.dispose();
  }
}

