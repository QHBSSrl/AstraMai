# 接入新音游：调研结论与待办

> 这份文档是"先去查一轮"之后的版本。原以为要逐个游戏找 API，
> 实际查完发现**结论和直觉相反**：街机系几乎白送，手机音游反而更难或不可行。
>
> **2026-10 更新**：中二节奏已接入并上线（core + 服务端，实测 18/18 通过）。
> Phigros 与太鼓的接口规范已拿到，方案写在文末。

---

## 零、已经做完的

| 项目 | 状态 |
|---|---|
| maimai DX 全链路 | ✅ 上线 |
| **中二节奏：core + 服务端** | ✅ **已上线**（曲库 1458 首、搜索、曲绘） |
| 中二节奏：玩家成绩（B30） | ⬜ 待做，需要确认密钥的中二权限 |
| 网页 / 手表的游戏切换 | ⬜ 待做 |

中二已上线的接口：

```
GET /api/v1/chunithm/songs              曲库，notes=1 带物量
GET /api/v1/chunithm/search?q=&limit=   曲目搜索
```

---

## 一、调研结论（重要，先看这个）

| 游戏 | 数据来源 | 可行性 | 前提 |
|---|---|---|---|
| **maimai DX** | 落雪 REST | ✅ 已完成 | 一个密钥 |
| **中二节奏 CHUNITHM** | **落雪 REST（同一个密钥）** | ✅ **几乎白送** | 见下 |
| 中二节奏（备用源） | 水鱼 divingfish | ✅ | 另一套密钥 |
| **Phigros** | 云存档 + session token + **原生库** | ⚠️ 可行但重 | 见下 |
| **Arcaea** | 游戏本地 `st3` 数据库 / cookie | ⚠️ 没有干净的公共 API | 见下 |
| **PJSK** | — | ❌ **社区查分已被迫关闭** | 见下 |
| 太鼓 / SDVX / IIDX | 落雪**不支持** | ❓ | 需要另找源 |

### 1. 中二节奏：白送（已实测确认）

落雪官方对自己的描述是「**舞萌 DX & 中二节奏国服查分器**」——
也就是说**我们已经在用的那个密钥，已经覆盖了第二个游戏**。

**我逐个试过落雪的游戏路径，实测结果：**

```
/api/v0/maimai/song/list        → 200,  770.2 KB   ✅
/api/v0/chunithm/song/list      → 200,  686.6 KB   ✅
/api/v0/chunithm/song/list?notes→ 200, 1108.1 KB   ✅
/api/v0/chunithm/alias/list     → 200,   31.0 KB   ✅

/api/v0/taiko/song/list         → 404
/api/v0/sdvx/song/list          → 404
/api/v0/iidx/song/list          → 404
/api/v0/ongeki/song/list        → 404
/api/v0/projectsekai/song/list  → 404
/api/v0/phigros/song/list       → 404
/api/v0/arcaea/song/list        → 404
```

**落雪确实只支持这两个游戏。**

**结构实测对比（这才是"白送"的依据）：**

```
maimai 曲库:  { songs, genres, versions }
chunithm 曲库: { songs, genres, versions }     ← 完全一致

song:        id, title, artist, genre, bpm, version, difficulties[]
difficulty:  difficulty, level, level_value, note_designer, version, notes
```

**所以差异只有三处，全是小改动：**

| | maimai | chunithm |
|---|---|---|
| 物量字段 | `tap hold slide **touch break**` | `tap hold slide **air flick**` |
| 难度档位 | 0–4（5 档） | **0–5（6 档）** |
| 成绩构成 | B35 + B15 | **B30 + Selection 10 + Recent 10** |

> ⚠️ 难度档位那条是我实测才发现的：文档只列了 0–4（BASIC…ULTIMA），
> 但真实数据里出现了 **5** —— CHUNITHM 有 **WORLD'S END**。
> 只看文档就会漏掉一整档，UI 上会显示成 `#5`。
> **这就是为什么不能只看文档。**

**结论：接入中二节奏 ≈ 加一个 Source + 一套 6 档难度配色。**
不是从零接一个游戏。这是当前性价比最高的一步。

> 文档：https://github.com/Lxns-Network/maimai-prober-frontend/wiki/中二节奏-API-列表
> 曲目数 1458（maimai 是 1300 左右）

### 2. PJSK：社区查分已经死了

Chieri（一个聚合了多套音游查分源的 QQ 机器人）的 PJSK 文档里写着：

> **由于 API 变更，用户信息查询功能已关闭**

现在只剩曲目信息、别称、谱面、猜歌这些**不需要登录**的功能。

**建议先别做。** 不是你找不到文档的问题——是整条路当前就是断的。
除非你打算自己逆向，那是另一个量级的项目。

### 3. Arcaea：没有干净的公共 API

- 官方 B30 接口**已废弃**
- 现在的做法是让用户**上传游戏本地的 `st3` 数据库**（要 root / LSPatch / 共存包）
- 或者上传 cookie（B30 仍然要手动同步）

也就是说：**要用户做技术操作才能查分**。这对"开放给大家"的产品是很高的门槛。
可以做成"进阶功能"，但不适合当主打。

### 4. Phigros：可行，但架构不一样

数据来自**云存档**，需要一个 **session token**，而且解密靠一个**原生库**
（`phigros.dll` / `libphigros-64.so`，C++ 写的）。

这带来三个具体影响：

1. **手表端做不了**，必须服务端跑（我们的服务端是 Linux 容器，可以用 `.so`）
2. **曲库不是 API**：定数表、曲绘是从**游戏 APK 里提取**的静态资源
   （[Phigros_Resource](https://github.com/7aGiven/Phigros_Resource)），要我们自己托管
3. 项目 README 里明确写着：

   > **严禁使用本项目或相关项目进行对 Phigros 数据库的攻击行为**，
   > 包括但不限于：大规模查分对鸽游服务器进行 DDOS

   **所以缓存和限速对 Phigros 不是"优化"，是"必须"。**

好消息是：**"用户提供 session token"这件事，正好可以用我们刚做好的配对同步**
从网页传到手表（或者只传到服务端）。这是那个功能的第二个用途。

---

## 二、还需要你去找的（比原来短很多了）

### A. 中二节奏（基本不用找了，确认两件事即可）

- [ ] 落雪的**认证头**：maimai 用的是 `x-lxns-key` 还是 `Authorization`？
      （我用的是前者，chunithm 文档写的是后者——需要确认是同一个还是不同）
- [ ] 我们的密钥有没有 chunithm 的权限？（在落雪账号里看一下）
- [ ] 中二节奏的**曲绘 URL 规则**（那套 `imageView2` 裁剪参数还灵不灵）

### B. 太鼓 / SDVX / IIDX（确定要不要做）

- [ ] 落雪不支持，那么有没有别的聚合源？
      （水鱼 divingfish？或者日服的官方 API？）
- [ ] 如果都没有，就明确**跳过**，别在这上面耗

### C. Phigros（决定要不要投入）

- [ ] 你是否接受"服务端跑原生库 + 自己托管定数表"这个成本？
- [ ] 定数表的更新频率？（游戏更新就要跟）
- [ ] 有没有现成的、**已经托管好这些**的第三方服务可以直接对接？
      （如果有，那就变成接一个 REST，成本骤降）

### D. 私服（你提到的"各种私服"）

- [ ] 具体是哪些游戏的私服？（maimai 私服？chunithm 私服？）
- [ ] 它们的接口和官服一致吗？
- [ ] 地址固定还是用户可配？
- [ ] 认证方式？

> 建议：**私服做成独立的 Source**，不要在官服实现里加 if。
> 否则官服一改结构，私服那半边跟着烂。

---

## 三、我建议的推进顺序

```
1. 中二节奏          ← 白送。加一个 Source + 一套难度配色
2. 首页改成先选游戏    ← 加第二个游戏后，现在的 4 个入口会超出一屏
3. 私服              ← 复用中二/maimai 的结构，只是换个 base URL
4. Phigros           ← 要看你对"服务端跑原生库"的接受度
5. Arcaea            ← 门槛在用户侧（要上传存档），看要不要做进阶功能
6. PJSK              ← 当前整条路是断的，等生态恢复
```

---

## 四、架构上已经准备好的部分（你不用管）

服务端早就抽象好了，接新游戏是**加一个 DataSource**：

```
apps/server/src/sources/
  types.ts      ← DataSource 接口
  lxns.ts       ← 现有实现（接中二时可以照抄结构）
  registry.ts   ← 注册表
```

每个 Source 只需要提供：**取玩家 + 取成绩 + 取曲库**。
鉴权、缓存、限速、降级、上游预算这些框架都已经做好并有测试覆盖。

**中二节奏可以复用同一个 `LxnsSource`**，只要把路径前缀从 `maimai` 换成 `chunithm`、
把成绩字段的映射改掉——因为它是同一家服务。

---

## 五、最小可开工集合

对每个新游戏，只要有这三样我就能开工并**对着真实数据验证**：

1. 一条能跑通的请求 + 真实响应 JSON
2. 曲库接口的真实响应
3. 封面 URL 的一个真实例子

这轮 maimai 的坑（`JSON.parse('123456789012345')` 会成功返回数字那个）
就是对真实数据写测试时才炸出来的。

---

## 六、Phigros 与太鼓：规范已拿到（2026-10 补）

### Phigros —— 比预想的好得多

`https://lilith.xtower.site/api-docs/`（Phigros Query 开放平台）

**关键发现：这是托管的 REST 服务，不需要我们自己跑那个 C++ 原生库。**
之前查到 `philib` 要 `phigros.dll` 时以为很重，原来已经有人把它托管好了。

```
Base   https://r0semi.xtower.site/api/v1/open/
Auth   header  X-OpenApi-Token: <key>
```

| 接口 | 作用 |
|---|---|
| `POST /auth/qrcode?taptapVersion=cn` | 生成 TapTap 登录二维码 → `{qrId, verificationUrl, qrcodeBase64}` |
| `GET /auth/qrcode/{qrId}/status` | 轮询 → `{status, retryAfter, sessionToken}` |
| `POST /save?calculate_rks=true` | 传 `{sessionToken, taptapVersion}` → 存档 + RKS + B30 + 评级统计 |
| `GET /songs/search?q=&limit=` | 曲目搜索 → `{items:[{id,name,composer,chartConstants:{ez,hd,in,at}}], total, hasMore}` |

**实测确认**（用你给的测试 key）：

```
q=Spasmodic  → Spasmodic | 定数 EZ8.2 HD12.9 IN15.5 AT16.7
q=云         → 云女孩 / 星拂云锦      ← 中文搜索正常
```

**接入方式与其它游戏不同，要注意：**

- 玩家标识是 **sessionToken**，来自 **TapTap 扫码登录**
- 也就是说：**扫码这一步必须在网页上做**（手表上没有摄像头也没有 TapTap）
  → 正好是配对同步的用武之地：网页扫码拿到 token → 传给手表
- **曲绘不在这个 API 里**：`/songs/search` 只给 `illustrator`（插画师名），没有图 URL
  → 曲绘要么另找资源站，要么只显示插画师名
- 难度只有 4 档：**EZ / HD / IN / AT**（比中二简单）
- 存档里的成绩是**按 `曲名.曲师` 为键**的字典，不是数组——映射时要转一下
- `chartConstants` 是定数表，正好补齐曲库缺的那部分

**待确认**：`pgr_test_...` 是测试 key，正式接入需要换成生产 key，
并确认它的 rate limit 与 scope。

### 太鼓之达人 —— 接口规范已明确

`https://viewer.sakura-bot.cn/docs/score-token`（Sakura Taiko Viewer）

```
POST https://sakura-bot.cn/api/public-score/by-token
Content-Type: application/json
body: {"token":"用户的48位token"}
```

返回：

```json
{
  "ok": true,
  "taikoId": "2258735",
  "fetchedAt": "...",
  "data": {
    "profile": { "mydon_name": "...", "userid": "...", "province": "...", ... },
    "songs": [{ "song_no": 187, "level": 4, "high_score": 1000000,
                "good_cnt": 160, "ok_cnt": 0, "ng_cnt": 0,
                "combo_cnt": 160, "clear_cnt": 1, "full_combo_cnt": 1,
                "dondaful_combo_cnt": 1, "highscore_datetime": "..." }],
    "achievement": { "count_level": 5, "ary_crown_count": [...], "ary_score_rank_count": [...] }
  }
}
```

**又是"用户提供凭证"的模式**（48 位 token）→ 同样走配对同步。

文档里明确写了三条约束，接的时候必须遵守：

> - 接口支持 CORS，可由浏览器直接请求；有后端时**建议服务端代调用**，减少 token 暴露
> - 接口返回前会尝试拉取最新成绩。**请避免高频轮询**，并在业务侧设置短时间缓存
> - **不要把 token 写入日志、埋点、URL 查询参数或错误上报**

错误码：`400` 请求体/token 非法 · `401` token 无效或已轮换 ·
`404` 绑定 ID 或本地成绩不存在 · `502` 上游拉取失败

**待确认**：你正在申请开发者 API，批下来后需要确认
「开发者 API」和这个「用户 token API」是不是同一套。

### 两个游戏共同的结论

**它们都是"用户提供凭证"模型**（Phigros 是 sessionToken、太鼓是 48 位 token）。
这意味着：

1. **配对同步功能的价值远不止 maimai** —— 它是"把用户凭证安全送到手表"的通用通道
2. 服务端必须**缓存 + 限速**，两边文档都明确要求了（太鼓甚至写进了接入约束）
3. **凭证不能进日志** —— 我们现有的 diag 上报通道要小心，别把请求体原样打回去

---

## 七、Rin 服（2026-10 调研）

用户机厅用的是 Rin 服。查下来结论是**可行，但和前面所有源都不同**。

### 它是什么

Rin 服是 **AquaDX 架构**的街机私服，而且**门户前端开源**：

- 前端：https://github.com/RinNET-OpenSource/RinNET_frontend （AGPL-3.0）
- 门户：https://portal.naominet.live
- 后端：`http://aqua.naominet.live`（门户用同源代理转发 `/api`）
- 覆盖游戏：`chuni` / `mai2` / `ongeki`

**前端开源这件事很关键**：接口调用代码是公开可读的，
所以不用去猜、也不用去探他们的线上服务（对别人的服务器客气一点）。

### 接口形态

```
鉴权    OAuth2（BEMANICN / Microsoft / GitHub / GitLab）→ JWT
请求头  Authorization: <tokenType> <accessToken>   例如 BEMANICN eyJ...
刷新    POST /api/auth/refresh  { refreshToken }
        accessToken 是 JWT，带 exp；官方前端在过期前 30s 主动刷新
```

已确认的端点（从中二页面读出）：

```
GET    /api/auth/signin/oauth2/{type}          取授权跳转地址
GET    /api/user/profiles                       各游戏资料汇总
GET    /api/game/chuni/v2/profile?aimeId=       玩家资料
GET    /api/game/chuni/v2/friend?aimeId=        对手列表
POST   /api/game/chuni/v2/friend?friendId=&aimeId=
DELETE /api/game/chuni/v2/friend?friendId=&aimeId=
GET    /api/game/chuni/v2/toggleFavorite?friendId=&aimeId=
```

玩家标识是 **`aimeId`**（来自 `user.defaultCard.extId`），
**不是好友码**。对外显示 ID 的算法是 `10_000_000 + defaultCard.id`。

### 三个必须知道的事

**1. 它没有落雪那种「一个开发者密钥查所有人」的公共 API。**

你能查的默认是**你自己**（OAuth 登录后的 aimeId）。
查别人要先通过 `friendId` 加为对手，而且对手模型只带
`rivalName / playerRating / overPowerRate / level` 这些**摘要**，
**没有完整成绩列表**。

**2. 第三方接入需要服主配合。**

OAuth 授权地址是给门户自己用的，**第三方应用要用得先确认
redirect URI 能不能自定义、要不要在服务端注册客户端**。
这一条得去问 RinNET 的人，不是我们这边能定的。

**3. AGPL-3.0。**

前端是 AGPL。**读接口定义做互操作没问题，但不能把它的代码抄进我们仓库**——
那会把整个项目拖进 AGPL。我们的接入必须是自己写的客户端。

### 对我们的意义

Rin 的接入模型和 Phigros / 太鼓**是同一类**：用户授权 → 我们拿凭证 → 查他自己。
所以：

- **配对同步依然是正确的载体**（网页 OAuth 登录 → 凭证同步到手表）
- 服务端要新增一类 Source：**带 OAuth 令牌的、按用户维度的**
- 和落雪那种"全局密钥"的 Source 在缓存策略上完全不同
  （落雪的曲库能全局缓存；Rin 的玩家数据是按账号的）

### 下一步要问 RinNET 的

- [ ] 第三方应用能不能用你们的 OAuth？需要注册吗？
- [ ] 有没有面向第三方的 API 文档或开发者通道？
- [ ] 查对手的完整成绩（不只是摘要）有没有接口？
- [ ] 有没有速率限制的约定？

> 注意：这是**别人的私服**，接入前先问一声是基本的礼貌，
> 也避免我们做完了被挡回来。


