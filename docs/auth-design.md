# 账号体系与订阅（TwinkleAstra + Casdoor）

> 2026-11-08 提出。**这一版只写设计，不实现** —— 账号体系的决策改一次成本很高，
> 先把问题摆清楚再动手。

---

## 一、需求原话

> 软件要接入 TwinkleAstra 账号体系，后期我们要改一些功能加入鉴权和
> 必须 AstraMai Plus 订阅才能使用（登录账号后自动订阅，免费）。
> 所以我们还要部署一个 Casdoor。

拆开是四件事：

1. **账号** —— 用 TwinkleAstra 这个统一身份，不是自己建一套
2. **鉴权** —— 某些接口要登录才能调
3. **订阅** —— 某些功能要 AstraMai Plus
4. **Casdoor** —— 部署它来做上面三件事

---

## 二、Casdoor 是什么，能干什么

开源的统一身份认证平台（OIDC / OAuth 2.0 / SAML / LDAP 都支持），
Go 写的，单二进制，Docker 一跑就有。

**它给我们提供：**

| 能力 | 用在哪 |
|---|---|
| OIDC 授权码 + PKCE | App 登录 |
| 用户表 | TwinkleAstra 账号 |
| 组织 / 角色 | 区分普通用户 / Plus |
| 用户属性（自定义字段） | 存订阅状态 |
| 第三方登录 | 后面接 QQ / GitHub |
| 管理后台 | 封号、改订阅 |

**它不提供：**

- 订阅计费（但我们免费，不需要）
- 业务数据库（成绩、绑定这些还是我们自己的）

---

## 三、整体架构

```
┌──────────────┐
│  Flutter App │
│  (三端)      │
└──────┬───────┘
       │ 1. 走 OIDC 授权码 + PKCE
       ▼
┌──────────────┐
│   Casdoor    │  ← 部署在阿里云（和现有 server 同机或旁边）
│  auth.xxx    │
└──────┬───────┘
       │ 2. 返回 access_token (JWT)
       ▼
┌──────────────┐
│ AstraMai API │  ← 现有的 apps/server
│              │ 3. 校验 JWT（用 Casdoor 的公钥）
│              │ 4. 检查订阅（Plus 才能用的接口）
└──────────────┘
```

**关键：Casdoor 只负责「你是谁」，不负责「你能干什么」。**
「能不能用这个功能」是我们自己的接口在判断。

---

## 四、三个必须先定的问题

### 问题 1：阿里云那台机器扛得住吗

现在的机器：**2 核 / 1676 MB**，已经跑着 AstraMai server。

Casdoor 自己大概吃 **150–250 MB**。加上我们现在的服务，**内存会很紧**。

**三个选项：**

| 方案 | 成本 | 风险 |
|---|---|---|
| A. 同机加容器 | 0 | 内存可能不够，OOM 会两个一起死 |
| B. 换更大的机器（4G） | 阿里云差价 | 稳定 |
| **C. 用 Casdoor 的官方演示实例先跑通** | 0 | 不能上线，只能验证流程 |

**建议先 C 验证，然后按 B 升级。** 2G 的机器跑两个服务太勉强。

### 问题 2：App 怎么登录

Flutter 走 OIDC 需要一个**系统浏览器**（不能用 WebView，Casdoor 会拒绝）。

**流程：**

```
App 点「登录」
  → 打开系统浏览器到 Casdoor 授权页
  → 用户在浏览器里登录（可能已经登录过 TwinkleAstra，就直接过了）
  → Casdoor 重定向回 astramai://callback?code=xxx
  → App 用 code 换 token
```

**需要：**

- 一个 `app_links` 或 `uni_links` 插件处理深链
- 在三个平台都注册 `astramai://` scheme
- 鸿蒙那边要单独确认支持

**⚠️ 鸿蒙的深链支持是这个方案最大的不确定点。** 那块要单独验证。

### 问题 3：订阅怎么判断

「登录后自动订阅，免费」意味着：

**每个新用户注册时自动获得 Plus。**

这有两种实现：

| 方式 | 怎么判断 | 优点 | 缺点 |
|---|---|---|---|
| **A. Casdoor 组织** | 用户在 `astramai-plus` 组织里 | 不用自己建表 | 加组织要在 Casdoor 后台操作 |
| **B. Casdoor 用户属性** | `user.properties.plus = "true"` | 灵活，可以存到期时间 | 要写 Casdoor 的 API |
| **C. 我们自己的表** | `subscriptions(user_id, plan, expires_at)` | 完全可控，以后好扩展 | 多一张表，多一次查询 |

**建议 B** —— 用 Casdoor 的自定义属性，但**在我们这边缓存**。

理由：Casdoor 的属性改动没有 webhook，每次请求都去问它会拖慢；
缓存 5 分钟，用户升级/降级最多延迟 5 分钟生效，可以接受。

---

## 五、哪些功能要 Plus

**这个必须现在就想清楚，不然设计完了才发现接口分不开。**

按「核心体验免费，增值功能付费」的原则，但**我们免费**，
所以 Plus 更像是「登录特权」而不是「付费墙」。

**建议这样分：**

| 功能 | 要求 | 理由 |
|---|---|---|
| 查分（B50 / B30 / RKS / pp） | **免费** | 这是 App 的根本，不能锁 |
| 曲目搜索 | **免费** | 同上 |
| 绑定多个账号 | 免费 | |
| 推分计算器 | **Plus** | 有个性化数据，需要账号 |
| 成绩对比（历史变化） | **Plus** | 要存历史快照，服务端成本 |
| 二维码生成 | 免费 | 本地就能算，锁了没意义 |
| 分享成绩图 | **Plus** | 要服务端渲染 |
| 未来：成绩分析 / 推荐 | **Plus** | |

**⚠️ 有一条铁律：查分永远免费。**
一个查分工具如果连查分都要登录，用户会直接卸载。

---

## 六、数据怎么存

### 服务端要加的

```
users
  casdoor_id      TEXT PRIMARY KEY   ← Casdoor 的 user id
  display_name    TEXT
  created_at      TIMESTAMP
  last_seen_at    TIMESTAMP

bindings
  casdoor_id      TEXT
  game            TEXT   ← maimai / chunithm / osu / phigros
  value           TEXT   ← 好友码 / QQ / 用户名
  PRIMARY KEY (casdoor_id, game)

rating_history
  casdoor_id      TEXT
  game            TEXT
  rating          INTEGER
  recorded_at     TIMESTAMP
```

**rating_history 是「成绩对比」和「历史曲线」的基础。**
每次查分时顺手写一条，去重按天。

### 本地还可以存什么

**绑定信息继续存本地**，同时**登录后同步到服务端**。

这样：

- 没登录 → 本地绑定，单机可用
- 登录后 → 本地 + 云端，换设备能恢复

---

## 七、部署 Casdoor 的步骤（粗略）

```bash
# 1. 起容器
docker run -d --name casdoor \
  -p 8000:8000 \
  -e driverName=postgres \
  -e dataSourceName="user=... password=..." \
  casbin/casdoor:latest

# 2. 初始化（第一次访问 / 会引导建管理员）

# 3. 建组织和应用
#    - 组织：astramai
#    - 应用：astramai-app（OIDC，配重定向 URI）

# 4. 拿到 client_id / client_secret / 公钥
```

**⚠️ 它需要数据库。** 用 SQLite 也行（单机够），但备份要跟上。

---

## 八、实施顺序（建议）

| 阶段 | 做什么 | 依赖 |
|---|---|---|
| **0** | 现在的功能先做完（查分、推分、对比、我的） | 无 |
| **1** | 用 Casdoor 官方 demo 实例验证 OIDC 流程能走通 | 无 |
| **2** | 升级服务器到 4G，部署 Casdoor | 阶段 1 通过 |
| **3** | App 接入登录，加 `astramai://` 深链 | 阶段 2 |
| **4** | 服务端加 JWT 校验 + 订阅检查 | 阶段 3 |
| **5** | 把推分/对比/分享标记成 Plus | 阶段 4 |

**⚠️ 不要在第 0 阶段没做完的时候跳去做账号。**
一个能用的 App 加账号是加分项，一个半成品加账号是浪费。

---

## 九、还没想清楚的地方

1. **鸿蒙的深链** —— OpenHarmony SIG 的 Flutter fork 支持 `app_links` 吗？要验证。
2. **未登录用户的数据** —— 本地绑定改名后，登录时怎么合并？按什么规则？
3. **Casdoor 的备份** —— 用户表丢了等于所有人都要重新注册。
4. **「TwinkleAstra 账号体系」的具体形态** —— 是已经有一个现成的 Casdoor 实例，
   还是要我们建？如果是共用的，那 AstraMai 是其中一个「应用」。

**第 4 条最关键，需要你确认。**
