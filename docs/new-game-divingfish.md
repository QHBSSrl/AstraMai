# 水鱼查分器（diving-fish）接入调研

> 2026-10-29。可用于**舞萌 DX** 和**中二节奏**。
>
> 目标：做**查分器自适应** —— 同一个玩家，落雪和水鱼**哪个数据新用哪个**。

---

## 一、先说凭据的事（重要）

你发在聊天里的两个字符串，我实测了：

```
K0-CYO8ZV_FgTCGImgqx_W-I6d5yl7VwqgA5dITadCQ   (43 字符)
ac61d7ab7582c2b63a16e414471d37cf              (32 位 hex)
```

**都不被接受**：

| 当作 | 结果 |
|---|---|
| `Developer-Token`（第一个） | `400 {"msg":"开发者token有误"}` |
| `Developer-Token`（第二个） | `400 {"msg":"开发者token有误"}` |
| `Authorization: Bearer <第一个>` | `401 {"message":"access token 格式不正确"}` |

**原因很可能是**：官方文档明确写着

> `Developer-Token` **已停止签发**，其对应的 `/dev/*` 端点已进入废弃状态，
> 将于 **2027 年 1 月 1 日 00:00（UTC+8）** 停止服务。
> 第三方应用请改用水鱼账号 **OAuth** 授权。

所以你在开发者控制台拿到的多半是 **OAuth 的 `client_id` / `client_secret`**，
而不是旧的 Developer-Token。这两个东西用途完全不同：

- **Developer-Token**（旧）：一把钥匙，能查**任何人**
- **OAuth**（新）：用户逐个授权，token 代表**某一个用户**

> ⚠️ **这两条凭据已经明文出现在聊天记录里了。**
> 不管它们是什么，建议去 [开发者控制台](https://auth.diving-fish.com/console)
> 重置一次。我这边只把它们写进了 `.env`（已确认被 gitignore、没进过 git），
> 但聊天记录本身是另一回事。

---

## 二、实测结果

### 能用的（无需验证）

| 端点 | 结果 |
|---|---|
| `GET /api/maimaidxprober/music_data` | ✅ 200，903.5 KB |
| `GET /api/maimaidxprober/alive_check` | ✅ 200 `{"message":"ok"}` |
| `GET /api/maimaidxprober/player/test_data` | ✅ 200，300.6 KB，**1438 条成绩** |
| `GET /api/chunithmprober/player/test_data` | ✅ 200，但 best 是空数组 |
| `POST /api/maimaidxprober/query/player` | ✅ 端点通（返回 `user not exists` 是业务错误，不是鉴权错误） |

### 关键：`/query/player` 是**公开**的

```json
POST /api/maimaidxprober/query/player
{"qq": "3687236844"}

→ 400 {"message": "user not exists"}
```

**这说明端点本身不需要任何 token** —— 失败只是因为那个 QQ 没绑定水鱼。

按文档：

> 获取歌曲详细信息、获取歌曲封面、查询用户基本信息（**包括 b50、rating**）
> 等功能**无需验证信息即可访问**，对于和用户相关的信息访问成功与否通常
> 取决于**用户是否允许其他人获取成绩**。

**所以大部分玩家（没开隐私）查 B50 根本不需要 token。**

---

## 三、数据结构（已经拿到真实样例）

### 舞萌：`/player/test_data`

```json
{
  "nickname": "水鱼",
  "rating": 15327,
  "additional_rating": ...,
  "plate": "",
  "username": "DivingFish",
  "records": [ ... 1438 条 ... ]
}
```

单条 record：

```
achievements  ds  dxScore  fc  fs  level  level_index
level_label  ra  rate  song_id  title  type
```

示例：

```
song_id=17  level_index=4  achievements=100.5777  dxScore=1369  fc=fcp  fs=fsp
```

**和落雪的字段对比：**

| 需要 | 水鱼 | 落雪 |
|---|---|---|
| 曲名 | `title` | `title` |
| 难度下标 | `level_index` | `level_index` |
| 定数 | `ds` | `ds` |
| 达成率 | `achievements` | `achievements` |
| DX 分数 | `dxScore` | `dxScore` |
| 单曲 Rating | `ra` | `ra` |
| FC/FS | `fc` / `fs` | `fc` / `fs` |
| 谱面类型 | `type`（`DX`/`SD`） | `type` |

**几乎一模一样。** 因为落雪和水鱼本来就是同一套舞萌领域的字段命名。

### 中二：`/chunithmprober/player/test_data`

```json
{ "rating": 0.0, "username": "DivingFish", "records": { "best": [], "r10": [] } }
```

`test_data` 没给填充数据，但结构是 `records.best[]` + `records.r10[]`。

---

## 四、自适应的设计

### 你提的规则

> 同样 QQ 号或者玩家 ID，哪个数据新调取哪个 API

### 问题：**两边都没有「最后更新时间」**

我查了落雪和水鱼的字段，**都没有一个直接的「数据抓取时间」**。

能间接判断的是：

| 线索 | 落雪 | 水鱼 |
|---|---|---|
| 成绩里有时间戳吗 | 有 `lastPlayedTime`（部分接口） | ❌ 没有 |
| 玩家资料里有更新时间吗 | ❌ | ❌ |
| 成绩条数 | 有 | 有 |

所以「哪个新」只能**间接推断**，我的建议是：

### 方案：**双源并行 + 数据指纹对比**

```
1. 两边同时查（并发，省时间）
2. 算一个「成绩指纹」：把所有 record 按 song_id + level_index 排序，
   拼成 (song_id, level_index, achievements, dxScore) 的序列，取 hash
3. 指纹不同 → 说明有一边是旧数据
      · 谁的 Rating 高用谁？不靠谱（可能只是重打了一首低分）
      · 谁的 record 数量多？也不靠谱（可能删了成绩）
      · **谁的 achievements 总和更大？** 相对靠谱一点
4. 指纹相同 → 随便用哪个（说明两边数据一致）
```

**但更实用的做法**：**让用户选**。

```json
设置 → 查分源
  ● 自动（两源对比，用数据更全的）
  ○ 落雪
  ○ 水鱼
```

和「传输方式」那个开关一样 —— 用户可感知的取舍，交给用户。

### 落雪 vs 水鱼的**可靠性**对比

| | 落雪 | 水鱼 |
|---|---|---|
| 官方性质 | 第三方，但要**开发者密钥** | **半官方**（它自己就是查分器本体） |
| 密钥状态 | ✅ 正常 | ⚠️ Developer-Token 已停发，要走 OAuth |
| 公开查询 | ❌ 要密钥 | ✅ `/query/player` 无需验证 |
| 中二支持 | ✅ | ✅ |
| 中二官方 Rating | ✅ | ✅ |

**有意思的是**：水鱼的**公开端点**比落雪更开放 —— 落雪每次查询都花我们的密钥额度，
而水鱼查 B50 根本不用密钥。**所以水鱼应该做主力，落雪做备份。**

---

## 五、建议的落地顺序

### 第一步（今晚能做完）：只接公开端点

```
POST /api/maimaidxprober/query/player    {"qq": ...}    舞萌 B50
POST /api/maimaidxprober/query/player    {"username": ...}
POST /api/chunithmprober/query/player    {"qq": ...}    中二 B30
```

**不需要任何凭据。** 只要玩家没开水鱼隐私保护就能查到。

写一个 `sources/divingfish.ts`，实现和 `sources/lxns.ts` 一样的 `DataSource` 接口。

### 第二步：自适应

`GatewayService.getB50` 里加一个 `preferSource` 参数，
或者干脆在路由层做：两个源都试，谁成谁上。

### 第三步（如果要完整成绩）：OAuth

`/player/records` 要 Bearer，要走水鱼账号授权流程。
**这个可以往后放** —— B50 用公开端点就够。

---

## 六、待确认

1. **你给的那两个字符串到底是什么？**
   去 [开发者控制台](https://auth.diving-fish.com/console) 看一眼，
   是 `client_id` / `client_secret` 还是别的。
2. 你希望**哪个水源是默认**？（我倾向水鱼）
3. 自适应如果两边数据冲突，**用哪边**？（我倾向：高 Rating 那边 +
   在界面上标一句「来自水鱼/落雪」）

---

## 七、OAuth 文档读完后的补充

### 那个凭据是什么（几乎是确定的）

官方 OAuth 快速开始写着：

> 请在登记完成后于**控制台生成 `client_secret`** —— 登记应用与生成凭据
> 是两个独立的动作，只做前者的话应用没有任何可用凭据，所有请求都会得到 401。

以及：

> `client_secret` **只在生成的那一刻显示一次**，服务端保存的是它的哈希值。

所以你在控制台拿到的应该是：

| 字符串 | 长度 | 猜测 |
|---|---|---|
| `K0-CYO8ZV_...` | 43 | `client_secret` |
| `ac61d7ab...` | 32 hex | `client_id`（或反过来） |

**这两个不是 Developer-Token，所以 `/dev/*` 和 `Bearer` 都会拒绝它们 —— 我实测的结果就这样。**

### 但有个更好的消息

OAuth 文档里写着一条**不需要预先绑定**的路：

> 此外还有一种写法不需要事先绑定：`subject=username:<查分器用户名>`，
> **所有应用均可长期使用**，适用于「用户名由第三方在查询时临时给出」的场景
> （例如**群聊中查询他人的成绩**）。

也就是说，只要走通 OAuth 一次（用 `client_secret` 换票），
就能按**水鱼用户名**查任何人 —— 不需要每个用户单独授权。

### 三种查法，按成本排

| 做法 | 需要什么 | 能查谁 | 适合 |
|---|---|---|---|
| **① `/query/player` 公开端点** | **什么都不需要** | 开了公开的玩家 | **主力** |
| ② OAuth + `subject=username:` | `client_id` + `client_secret` | 任何人 | 公开端点失败时兜底 |
| ③ OAuth + 用户绑定 | 用户逐个授权 | 授权过的玩家 | 要读完整成绩时 |

**① 是免费且无需维护的**。落雪每次查询花我们的密钥额度，而水鱼这个不花。
**所以水鱼应该做主力，落雪做备份。**

### 中二那边同理

```
POST /api/chunithmprober/query/player   {"qq": ...} 或 {"username": ...}
```

文档里标的是「无需验证 / Bearer」——和舞萌一样，公开可用。
---

## 八、实测：真实用户的 `/query/player` 返回

### 用 `rating_ranking` 挑真实用户测

```
GET /api/maimaidxprober/rating_ranking
→ 200, 5443 KB, 146,999 个用户
```

**水鱼有 14.7 万注册用户。** 这是它最大的价值 —— 和落雪是**两拨人**。

试了 8 个（按 Rating 从高到低）：

```
✗ 张晓黎O          HTTP 400
✅ Calatorie11     rating=16565
✅ XYANIDE         rating=16565
✅ IsxI            rating=16565
✗ HT寒天           HTTP 400
✅ ddfw            rating=16565
✅ TheoryCollapsE  rating=16565
✅ zgrylyqd        rating=16565
```

**6 / 8 成功（75%）**。失败的返回 `400 user not exists`
或者 `403 已设置隐私或未同意用户协议`。

### 真实响应结构

```json
{
  "username": "Calatorie11",
  "nickname": "ezzzzzzz",
  "rating": 16565,
  "additional_rating": 19,      // 段位
  "plate": "祝神",
  "charts": {
    "sd": [ ... 25 条 ... ],
    "dx": [ ... 15 条 ... ]
  },
  "user_general_data": ...
}
```

单条 chart（和落雪的字段名几乎一致）：

```
title  level  level_index  level_label  type
dxScore  achievements  rate  fc  fs  ra  ds  song_id
```

示例：

```
PANDORA PARADOXXX  lv4 Re:MASTER  100.5735%  ra=337  type=SD
Xaleid◆scopiX      lv4 Re:MASTER  100.5207%  ra=337  type=DX
```

### ⚠️ `sd` / `dx` 和落雪的 `standard` / `dx` **不是一回事**

| | 含义 |
|---|---|
| **落雪** `standard[]` / `dx[]` | 按**新旧**分：旧曲 B35 / 新曲 B15 |
| **水鱼** `sd[]` / `dx[]` | 实测是 **25 + 15**，看起来也是按新旧分，但名字叫 sd/dx，容易误解 |

**看内容会更迷惑**：`sd` 里第一条 `type=SD`、第二条 `type=DX` —— 说明
`sd` 这个键**不是按谱面类型分的**，而是「旧曲」那一组。

**所以映射时必须按序号取，不能按 `type` 过滤。** 这点在写代码时要特别小心，
名字太容易骗人了。

### 中二那边

```
POST /api/chunithmprober/query/player  {"username": "Calatorie11"}
→ 200 {"nickname":"ezzzzzzz","rating":0.0,
       "records":{"b30":[],"n20":[],"r10":[]},"username":"Calatorie11"}
```

**结构是 `records.b30[]` + `records.n20[]` + `records.r10[]`** ——
和落雪的 `bests` / `selection` / `recent` 对应。

这个用户没玩中二，所以数组是空的，但**端点通、结构对**。

---

## 九、结论：值不值得做

### 你本人的情况

> 我本人只用落雪来着，水鱼没用过

那水鱼**对你个人没有直接价值** —— 你的成绩只在落雪上，水鱼查不到。

### 但对项目有意义

| 理由 | 说明 |
|---|---|
| **覆盖另一拨人** | 水鱼有 14.7 万用户，很多人只在水鱼注册 |
| **不花我们的额度** | 落雪每次查询花开发者密钥配额，水鱼公开端点不花 |
| **75% 可用率** | 实测 8 个用户里 6 个能查 |
| **中二也支持** | 同一套 API，一次做完两个游戏 |

### 但那 25% 查不到的怎么办

```
400 user not exists          → 这人没在水鱼注册
403 已设置隐私               → 注册了但不让公开查
```

**这两种都只能靠 OAuth**（用户授权）。所以在没有 OAuth 之前，
水鱼只能当**加分项**，不能当主力。

### 我的建议

**做，但排在后面，而且做成"兜底"而不是"主选"：**

```
查 B50 的流程：
  1. 先试落雪（你和我都熟悉，数据最全）
  2. 落雪返回「查不到这个玩家」→ 再试水鱼
  3. 两个都失败 → 报错，并说明双源都试过了
```

这样：
- 落雪用户**体验完全不变**
- 水鱼用户**也能用上**
- 不需要决定「哪个数据新」——**只需要决定「哪个有」**

**这比「比较数据新旧」简单得多，也更符合实际情况。**