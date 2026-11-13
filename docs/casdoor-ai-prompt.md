# 给 AI 的 Casdoor 配置提示词（复制下面整块）

> 用法：把下面 ``` 之间的内容整段复制，粘贴给一个**能 SSH / 能开浏览器** 的 AI，
> 并把尖括号里的值先填好。

---

```text
你是运维工程师。我需要你帮我配置一台已经跑起来的 Casdoor，让它为我的
Flutter 移动应用提供 OIDC 登录。请**实际动手操作**（SSH 登机器、开浏览器
点后台、必要时写配置文件），不要只给我建议。

# 一、环境

Casdoor 已经部署好了，我手上有的信息：

  访问地址      <填，例如 https://auth.example.com 或 http://内网IP:8000>
  管理员账号    <填>
  管理员密码    <填>
  部署方式      <Docker Compose / 单二进制 / 别的>
  数据库        <Postgres / MySQL / SQLite>
  服务器系统    <填，例如 Debian 12>
  SSH           <填，例如 root@10.0.0.5 -p 22>

如果上面有信息缺失，先问我，不要猜。

# 二、要做的业务

我的产品叫 AstraMai，是一个音游查分工具（查舞萌DX / 中二节奏 / osu! / Phigros
的成绩）。客户端是 Flutter，同时要出 Android、iOS、鸿蒙三端。

账号体系的要求：

1. 用 Casdoor 做统一身份认证（我们叫它「TwinkleAstra 账号」）
2. 部分功能要登录才能用
3. 有一个「会员」概念叫 AstraMai Plus，**注册后自动开通、免费**
4. 但除查分之外的功能（推分、成绩对比、分享）需要 Plus

**铁律：查分必须永远免费、不需要登录。** 一个查分工具如果连查分都要登录，
用户会直接卸载。所以 Casdoor 只负责「你是谁」，不负责「你能干什么」；
权限判断在我们自己的 API 里做。

# 三、必须完成的配置

## 3.1 组织（Organization）

- 名称（name，英文标识）：`astramai`
- 显示名：`AstraMai`
- 默认头像 / 主题色用默认值即可

## 3.2 角色（Role）

在 `astramai` 组织下建一个角色：

- 名称：`plus`
- 显示名：`AstraMai Plus`
- **设为新用户默认角色**（Casdoor 里叫 "Is default role" 或组织配置里的
  default role，不同版本位置不同，你自己找）

这样每个注册用户自动成为 Plus。

## 3.3 应用（Application）

- 名称：`astramai-app`
- 显示名：`AstraMai`
- 所属组织：`astramai`

认证配置：

| 项 | 值 |
|---|---|
| 客户端认证方式 | `Authorization Code`（不要 Implicit，不要 Password） |
| Token 格式 | `JWT` |
| **启用 PKCE** | **必须开启**，要求 S256 |
| Access Token 有效期 | 2 小时 |
| Refresh Token 有效期 | 30 天 |
| Refresh Token 是否轮换 | 开启 |

重定向 URI（**必须精确匹配，一个字符都不能差**）：

```
astramai://callback
```

如果 Casdoor 的输入框要求完整 URL 格式，就填：

```
astramai://callback
```

并且**不要**自动加尾斜杠。

## 3.4 JWT 里要包含的声明（Claims）

我们的 API 要校验这些，缺一个都没法用：

- `sub`      —— 用户的唯一 ID
- `name`     —— 用户名
- `email`    —— 邮箱
- `roles`    —— **必须包含角色列表**（用来判断是不是 Plus）

**`roles` 这一条最关键。** Casdoor 默认的 JWT 可能不包含角色，
你要在应用的 Token 配置里显式加上。不同版本的字段名可能是
"Token fields" / "Custom claims" / "JWT payload"，你自己找。

## 3.5 SMTP

配好 SMTP，让「找回密码」和「邮箱验证」能用。

我用的是：<填 SMTP 服务，例如 QQ邮箱 / 阿里云邮件推送 / 自建>

⚠️ QQ 邮箱的「密码」是**授权码**，不是登录密码。如果我用 QQ 邮箱，
提醒我去 QQ 邮箱设置里生成授权码。

## 3.6 关闭自助注册之外的入口（如果不需要）

如果 Casdoor 默认开了社交登录（GitHub / Google 之类）但我们没配，
在应用里把它们**关掉**，不然登录页会出现点不了的按钮。

# 四、必须产出给我的东西

配置完成之后，把下面这些值整理成一段可以直接复制的配置块给我：

```
CASDOOR_ISSUER=              # 例如 https://auth.example.com
CASDOOR_DISCOVERY_URL=       # $ISSUER/.well-known/openid-configuration
CASDOOR_CLIENT_ID=
CASDOOR_CLIENT_SECRET=
CASDOOR_REDIRECT_URI=astramai://callback
CASDOOR_SCOPE=openid profile email
CASDOOR_JWKS_URL=            # 用来验签
```

**Client Secret 只显示一次**，拿到之后立刻告诉我，别只放在屏幕上。

# 五、验证（必须真的跑过，把输出贴给我）

## 5.1 发现文档能访问

```bash
curl -s $CASDOOR_ISSUER/.well-known/openid-configuration | head -40
```

要能看到 `authorization_endpoint`、`token_endpoint`、`jwks_uri`、
`end_session_endpoint`。

## 5.2 JWKS 能拿到

```bash
curl -s $CASDOOR_JWKS_URL | head -20
```

要有 `"keys": [...]`，里面有 `kid` 和 `n` / `e`（RS256）或 `x` / `y`（ES256）。

## 5.3 授权码流程能走通

用 curl 或浏览器模拟一次（这段可以不完整，但你要真的试过）：

```bash
# 1. 打开授权页（浏览器，因为要登录）
open "$CASDOOR_ISSUER/login/oauth/authorize?client_id=$CASDOOR_CLIENT_ID&response_type=code&redirect_uri=astramai://callback&scope=openid+profile+email&state=test123&code_challenge=<S256>&code_challenge_method=S256"

# 2. 登录后会被重定向到 astramai://callback?code=xxx&state=test123
#    把 code 抄下来

# 3. 换 token
curl -s -X POST "$CASDOOR_ISSUER/api/login/oauth/access_token" \
  -d "grant_type=authorization_code" \
  -d "client_id=$CASDOOR_CLIENT_ID" \
  -d "client_secret=$CASDOOR_CLIENT_SECRET" \
  -d "code=<上一步的code>" \
  -d "redirect_uri=astramai://callback" \
  -d "code_verifier=<对应 challenge 的 verifier>"
```

能拿到 `access_token` 就算通。

## 5.4 解析 access_token，确认里面有 roles

```bash
# 把 access_token 的第二段 base64 解开看 JSON
echo "<access_token>" | cut -d. -f2 | base64 -d 2>/dev/null | jq
```

**必须能看到 `roles` 字段，且里面有 `plus`。**
如果没有，说明 3.4 没配好，回去改。

## 5.5 新用户自动带 plus

在后台手动建一个测试用户（或者在登录页注册一个），然后：

- 看它的 Roles 里是不是自动有 `plus`
- 拿它的 access_token 重复 5.4，确认 `roles` 里有 `plus`

**这一步不能跳过** —— 自动订阅是我们整个 Plus 方案的基础。

# 六、安全要求（不接受妥协）

1. **管理后台不要暴露在公网。**
   如果 Casdoor 和 nginx 在同一台，让我用 SSH 隧道访问：
   ```bash
   ssh -L 8000:127.0.0.1:8000 root@<服务器IP>
   ```
   然后浏览器开 http://localhost:8000

   如果它**已经**绑在 0.0.0.0 且公网可达，先告诉我，我们再决定
   是加 IP 白名单还是改成只监听内网。

2. **不要用 Implicit 流程。** 移动端必须是 Authorization Code + PKCE。

3. **不要把 Client Secret 写进任何 git 仓库。**
   给我之后，我自己放到服务器的 .env 里。

4. **确认 Token 签名算法是 RS256 或 ES256**（非对称），不是 HS256。
   HS256 意味着验签要用同一个 secret，那客户端就持有服务端密钥了。

5. 如果需要改 Casdoor 的 `app.conf` 或环境变量，**改之前先备份**，
   并且告诉我你改了什么。

# 七、如果遇到问题

常见坑，先自己排查：

| 现象 | 大概率原因 |
|---|---|
| 授权后重定向出错 | 回调 URI 不精确匹配（尾斜杠、大小写、端口） |
| 换 token 返回 `invalid_grant` | code 已用过 / 过期 / code_verifier 对不上 |
| 拿到的 JWT 里没有 roles | 应用的 Token 配置里没加这个 claim |
| 登录页样式错乱 | 反向代理没传 `Host` / `X-Forwarded-Proto` |
| 新用户没有 plus 角色 | 「默认角色」没设置，或设在别的组织下 |

排查时把关键日志贴给我，别只说「失败了」。

# 八、最后

做完之后给我一份简报：

1. 上面那个配置块（CASDOOR_* 的值）
2. 五条验证的实际输出
3. 你改过哪些文件 / 哪些配置项
4. 有什么没做到或者不确定的

**不要假装做过。** 没跑通的就说没跑通，我会安排时间一起看。
```

---

## 补一句给你（不是给 AI 的）

这份提示词里有三处**你必须先填**：

1. **`<访问地址>` / `<管理员账号密码>` / `<SSH>`** —— 第一节的表格
2. **`<SMTP 服务>`** —— 3.5 节
3. **`<服务器IP>`** —— 第六节的安全要求

填完之后再发给 AI。

**另外提醒一句：** 如果那个 AI 有 shell 权限，它改 Casdoor 配置时可能会
把容器搞挂。**先让它 `docker compose config` 或备份 `app.conf`** ——
我在提示词里写了这条，但你自己也盯着点。

配置完成后把那段 `CASDOOR_*` 发我，我这边就开始接 Flutter 的登录。
