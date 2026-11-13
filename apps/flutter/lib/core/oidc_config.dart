/// Casdoor / OIDC 的配置。
///
/// ── 这些值从哪来 ────────────────────────────────────────────────────
///
/// 由部署时配置的 Casdoor 实例提供，实测记录见
/// `D:\dsh workspace\.deploy\casdoor-oidc.md`。
///
/// ── ⚠️ 关于 client_secret ───────────────────────────────────────────
///
/// **移动端是「公开客户端」，严格来说不该持有 secret。**
/// secret 打进 APK 之后 reverse 一下就能拿出来，它不再是个秘密。
///
/// Casdoor 的 discovery 里 `token_endpoint_auth_methods_supported` 包含
/// `"none"`，所以理论上 PKCE-only 就能换 token。
///
/// 但 Casdoor 有些版本在配了 secret 之后会强制要求校验。所以这里做成
/// **可开关**：
///
///   · `useClientSecret = false`（默认）→ 走纯 PKCE，正确做法
///   · `useClientSecret = true`         → 带上 secret，兼容强制校验的部署
///
/// 如果登录时报 `invalid_client`，先试试打开这个开关。
///
/// **长期方案是把 token 交换挪到我们自己的服务端**（secret 留在服务器），
/// 客户端只把 code 发过去。那样 secret 才真的不落进 APK。
class OidcConfig {
  const OidcConfig._();

  /// 发行方。JWT 的 `iss` 必须是这个值。
  /// Casdoor 的发行方。
  ///
  /// 用的是 `astranexus.cn`，不是 `astnx.com`。两个域名指向同一台
  /// Casdoor，但新域名明显更快：
  ///
  /// ```
  /// pass.astranexus.cn   1.16s / 1.17s / 1.54s
  /// pass.astnx.com      25.0s / 2.66s / 25.0s   ← 三次里两次超时
  /// ```
  ///
  /// ⚠️ **这个域名刚上去时有过一段「SNI 被拒」的窗口**
  /// （`openssl s_client` 报 `tlsv1 unrecognized name`，手机浏览器报
  /// 「安全连接失败」）。那是 Cloudflare 在铺证书，不是配置错了 ——
  /// 过一段时间自己会好。
  ///
  /// ⚠️ **用 curl 测会误判** —— Windows 的 curl 走 schannel，有时不发
  /// SNI，拿到默认证书也能返回 200。**判断证书问题用 openssl s_client。**
  static const String issuer = 'https://pass.astranexus.cn';

  /// 发现文档。
  static const String discoveryUrl =
      'https://pass.astranexus.cn/.well-known/openid-configuration';

  /// JWKS（验签用）。
  static const String jwksUrl = 'https://pass.astranexus.cn/.well-known/jwks';

  static const String authorizationEndpoint =
      'https://pass.astranexus.cn/login/oauth/authorize';
  static const String tokenEndpoint =
      'https://pass.astranexus.cn/api/login/oauth/access_token';
  static const String userinfoEndpoint =
      'https://pass.astranexus.cn/api/userinfo';
  static const String logoutEndpoint = 'https://pass.astranexus.cn/api/logout';

  static const String clientId = '7341801684a7abffa6d7';

  /// 只有 [useClientSecret] 为 true 时才会用到。
  static const String clientSecret = '795e5e6517c370e3655eb78a43b1d599';

  /// 要不要在换 token 时带 secret。
  ///
  /// 默认 false —— 移动端应该走纯 PKCE。
  static const bool useClientSecret = false;

  /// 回调地址。
  ///
  /// ⚠️ 必须和 Casdoor 应用里配的**逐字符一致**（不能加尾斜杠）。
  static const String redirectUri = 'astramai://callback';

  /// 回调的 scheme —— 用来从被调起的 URL 里认出来。
  static const String callbackScheme = 'astramai';

  static const String scope = 'openid profile email';

  /// Plus 角色的名字。
  ///
  /// ⚠️ `roles` 在 JWT 里是**对象数组**，不是字符串数组：
  ///
  /// ```json
  /// "roles": [{"name": "plus", "displayName": "AstraMai Plus", ...}]
  /// ```
  ///
  /// 直接 `roles.contains('plus')` 会永远为 false。
  static const String plusRole = 'plus';

  /// 用户所属的组织名。
  static const String organization = 'astramai';
}
