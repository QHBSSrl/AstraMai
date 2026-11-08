import 'dart:convert';

import 'package:http/http.dart' as http;

import 'models.dart';

/// HTTP 客户端。
///
/// ── 为什么用 `http` 而不是 `dio` ────────────────────────────────────
///
/// `dio` 功能多，但我们只需要「发 GET/POST、解 JSON、超时」。
/// `http` 是 Dart 官方维护的，**纯 Dart 实现**，三端（Android / iOS / 鸿蒙）
/// 都不用额外适配 —— 而 `dio` 的一些适配器会碰平台代码。
///
/// 鸿蒙那边要用 OpenHarmony SIG 的 Flutter fork，纯 Dart 依赖是最稳的。
///
/// ── 为什么不在客户端拼上游 URL ──────────────────────────────────────
///
/// 我们的服务端（apps/server）已经把落雪/中二/Phigros/osu 的差异吃掉了，
/// 客户端只认 `/api/v1/...` 这一套。换数据源不需要改这里。
class ApiClient {
  ApiClient({String? baseUrl, http.Client? client})
      : _baseUrl = baseUrl ?? defaultServerBase,
        _client = client ?? http.Client();

  /// 默认服务器地址。
  ///
  /// 和手表端、网页端用的是同一台（阿里云）。
  /// ⚠️ 现在是 http 裸 IP，上 HTTPS 之后要改这里。
  static const String defaultServerBase = 'http://101.132.148.117:8787';

  /// 请求超时。网络差的时候 15 秒够了 —— 再久用户会以为死机。
  static const Duration timeout = Duration(seconds: 15);

  final String _baseUrl;
  final http.Client _client;

  String get baseUrl => _baseUrl;

  /// 发一个 GET，返回解析后的信封。
  ///
  /// 任何失败都抛 [ApiException]，调用方只需要 catch 一次。
  Future<Envelope<T>> get<T>(
    String path, {
    required T Function(Map<String, dynamic> json) parse,
    Map<String, String>? headers,
  }) async {
    final uri = Uri.parse('$_baseUrl$path');

    http.Response response;
    try {
      response = await _client
          .get(uri, headers: {..._defaultHeaders, ...?headers})
          .timeout(timeout);
    } on Exception catch (error) {
      throw ApiException('网络不通：$error');
    }

    return _decode(response, parse);
  }

  /// 发一个 POST（JSON body）。
  Future<Envelope<T>> post<T>(
    String path, {
    required T Function(Map<String, dynamic> json) parse,
    Map<String, dynamic>? body,
    Map<String, String>? headers,
  }) async {
    final uri = Uri.parse('$_baseUrl$path');

    http.Response response;
    try {
      response = await _client
          .post(
            uri,
            headers: {
              ..._defaultHeaders,
              'content-type': 'application/json; charset=utf-8',
              ...?headers,
            },
            body: body == null ? null : jsonEncode(body),
          )
          .timeout(timeout);
    } on Exception catch (error) {
      throw ApiException('网络不通：$error');
    }

    return _decode(response, parse);
  }

  /// 解信封。
  ///
  /// ⚠️ 服务端对**非 2xx** 也返回 JSON（带 `ok:false`），所以不能只看
  /// `statusCode` —— 要两个都看。只看状态码的话，400 会被当成"成功但没数据"。
  Envelope<T> _decode<T>(
    http.Response response,
    T Function(Map<String, dynamic> json) parse,
  ) {
    Map<String, dynamic>? json;
    try {
      final decoded = jsonDecode(utf8.decode(response.bodyBytes));
      if (decoded is Map<String, dynamic>) json = decoded;
    } on FormatException {
      // 不是 JSON —— 可能是网关的错误页
      throw ApiException(
        '服务器返回了非 JSON（HTTP ${response.statusCode}）：'
        '${response.body.length > 120 ? '${response.body.substring(0, 120)}…' : response.body}',
      );
    }

    if (json == null) {
      throw ApiException('服务器返回了看不懂的东西（HTTP ${response.statusCode}）');
    }

    final error = json['error'] is Map<String, dynamic>
        ? ApiError.fromJson(json['error'] as Map<String, dynamic>)
        : null;

    final envelope = Envelope<T>(
      ok: json['ok'] as bool? ?? false,
      success: json['success'] as bool? ?? false,
      mode: json['mode'] as String? ?? '',
      source: json['source'] as String? ?? '',
      elapsedMs: (json['elapsedMs'] as num?)?.toInt() ?? 0,
      message: json['message'] as String?,
      error: error,
      data: null,
    );

    // 非 2xx 或者 ok:false —— 都是失败
    if (response.statusCode >= 400 || envelope.ok == false) {
      throw ApiException(
        envelope.errorMessage(),
        status: response.statusCode,
        kind: error?.kind,
      );
    }

    final data = json['data'];
    if (data is Map<String, dynamic>) {
      return Envelope<T>(
        ok: envelope.ok,
        success: envelope.success,
        mode: envelope.mode,
        source: envelope.source,
        elapsedMs: envelope.elapsedMs,
        data: parse(data),
      );
    }

    // 有些接口 data 是数组或没有 —— 交给调用方判断
    return envelope;
  }

  static const Map<String, String> _defaultHeaders = {
    'accept': 'application/json',
  };

  void dispose() => _client.close();
}

/// 接口失败了。
class ApiException implements Exception {
  const ApiException(this.message, {this.status = 0, this.kind});

  final String message;
  final int status;
  final String? kind;

  /// 是不是"查不到这个玩家"。
  ///
  /// 服务端对这种情况返回 `bad-request` + 「没有找到这个玩家」。
  /// 界面上要把它和"网络坏了"区分开 —— 前者让用户改输入，
  /// 后者让用户检查网络。
  bool get isNotFound =>
      kind == 'bad-request' &&
      (message.contains('没有找到') || message.contains('不存在'));

  @override
  String toString() => message;
}
