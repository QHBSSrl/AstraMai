import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../core/oidc_client.dart';

/// 登录态的本地存储。
///
/// ── 为什么用 secure storage 而不是 SharedPreferences ────────────────
///
/// **refresh token 是长期凭据，泄露就等于账号被盗。**
///
/// SharedPreferences 在 Android 上是明文 XML、iOS 上是明文 plist，
/// root / 越狱设备上直接可读。
///
/// `flutter_secure_storage` 用的是：
///   · Android → EncryptedSharedPreferences（AES + Android Keystore）
///   · iOS     → Keychain
///
/// 这两个的密钥由系统管理，App 自己都读不出来。
///
/// ── ⚠️ 缓存的内容不可信 ────────────────────────────────────────────
///
/// 就算存在 secure storage 里，读出来之后也要**重新检查过期时间**。
/// 设备时间被改、或者存储被写坏，都可能得到一个看起来有效实际无效的 token。
class AuthStore {
  AuthStore({FlutterSecureStorage? storage})
      : _storage = storage ??
            const FlutterSecureStorage(
              aOptions: AndroidOptions(encryptedSharedPreferences: true),
            );

  final FlutterSecureStorage _storage;

  static const String _key = 'auth.tokens.v1';

  /// 读缓存的 token。
  ///
  /// 过期或损坏都返回 null —— 调用方当作「没登录」处理。
  Future<AuthTokens?> read() async {
    try {
      final raw = await _storage.read(key: _key);
      if (raw == null || raw.isEmpty) return null;

      final decoded = jsonDecode(raw);
      if (decoded is! Map<String, Object?>) return null;

      final tokens = AuthTokens.fromJson(decoded);

      // 不可信 —— 重新检查
      if (tokens.accessToken.isEmpty) return null;
      if (OidcClient.isExpired(tokens.claims)) return null;

      return tokens;
    } catch (_) {
      // 存储坏了就当没登录，不要让 App 起不来
      return null;
    }
  }

  /// 存 token。
  Future<void> write(AuthTokens tokens) async {
    await _storage.write(
      key: _key,
      value: jsonEncode(tokens.toJson()),
    );
  }

  /// 清掉（退出登录 / token 失效时）。
  Future<void> clear() async {
    await _storage.delete(key: _key);
  }
}
