# AstraMai 的 Casdoor OIDC 配置（已上线）

## 访问地址

- 公网（Cloudflare Tunnel）：**https://pass.astnx.com**
- 隧道：`astramai`（ID `31767520-9378-4dd6-9f58-34490c8fc978`），systemd 服务 `cloudflared.service`
- 配置：`/etc/cloudflared/config.yml`；凭据 `/root/.cloudflared/{cert.pem,<TUNNEL_ID>.json}`
- 入站端口：**零开放**，cloudflared 出站连 CF 边缘

## 已配置的资源

| 类型 | 值 |
|---|---|
| 组织 | `astramai`（显示名 AstraMai） |
| 角色 | `plus`（显示名 AstraMai Plus） |
| 组 | `plus-users`，角色 `plus` 授予该组（`role.groups=["astramai/plus-users"]`） |
| 应用 | `astramai-app`（归属 `astramai`） |
| 自动 Plus | 应用 `defaultGroup = astramai/plus-users` → 注册进组 → 继承 plus 角色 |

### 应用参数

| 项 | 值 |
|---|---|
| 授权类型 | `authorization_code` + `refresh_token` |
| Token 格式 | JWT / RS256（`cert-built-in`） |
| PKCE | S256 |
| Access Token | 2 小时 |
| Refresh Token | 30 天，轮换开启 |
| 重定向 URI | `astramai://callback` |
| tokenFields | `["roles"]` |

## 客户端配置块

```
CASDOOR_ISSUER=https://pass.astnx.com
CASDOOR_DISCOVERY_URL=https://pass.astnx.com/.well-known/openid-configuration
CASDOOR_JWKS_URL=https://pass.astnx.com/.well-known/jwks
CASDOOR_CLIENT_ID=7341801684a7abffa6d7
CASDOOR_CLIENT_SECRET=795e5e6517c370e3655eb78a43b1d599
CASDOOR_REDIRECT_URI=astramai://callback
CASDOOR_SCOPE=openid profile email
```

## 公网实测（2026-11-14）

```
1) 发码   : ok
2) 换token: ok
3) iss    : https://pass.astnx.com
4) roles  : ['plus']
5) 有效期 : 7200 秒 / refresh: True
6) sub    : 53579b4d-…  name: testplus03  email: testplus03@example.com
```

## 三个坑

### 1. `roles` 是对象数组

```dart
final isPlus = (claims['roles'] as List?)?.any((r) => r['name'] == 'plus') ?? false;
```

### 2. Cloudflare 会按 UA 拦请求

- `User-Agent: Python-urllib/3.12` → **403**（被 CF 机器人规则挡）
- `Dart/3.9 (dart:io)`、`curl`、无 UA → 正常到源站

Flutter 客户端不受影响，但**服务端之间调用时别用 python-urllib 的默认 UA**。

### 3. 注册的邮箱验证暂时关闭

SMTP 未配置，`signupItems` 的 Email/Phone 规则被设成 `No verification`。
Casdoor 的合法值是 `"No verification"`（不是 `"None"`）。SMTP 配好后改回 `Normal`。

## 待办

- [ ] `pass.astranexus.cn`：该域不在本次授权的 zone 内，需单独授权（`cloudflared tunnel login` 再走一次）后加 ingress + DNS
- [ ] SMTP 配置 → 恢复邮箱验证
- [ ] 删除测试账号 `testplus03`（密码 TestPlus123!）
