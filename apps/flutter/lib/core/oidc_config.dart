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
  static const String issuer = 'https://pass.astnx.com';

  /// 发现文档。
  static const String discoveryUrl =
      'https://pass.astnx.com/.well-known/openid-configuration';

  /// JWKS（验签用）。
  static const String jwksUrl = 'https://pass.astnx.com/.well-known/jwks';

  static const String authorizationEndpoint =
      'https://pass.astnx.com/login/oauth/authorize';
  static const String tokenEndpoint =
      'https://pass.astnx.com/api/login/oauth/access_token';
  static const String userinfoEndpoint =
      'https://pass.astnx.com/api/userinfo';
  static const String logoutEndpoint = 'https://pass.astnx.com/api/logout';

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
