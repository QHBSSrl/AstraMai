# 舞立方（DanceCube）接入调研

> 调研时间：2026-10-25
> 参考资料：<https://github.com/LingerJAB/DanceCubeBot>（Java + Mirai，GPL-3.0）
>
> **结论：可以做，而且比想象中简单。**

---

## 一、数据源：盛华娱乐的私有 API

舞立方（DanceCube）由盛华娱乐运营，没有公开 API。
`DanceCubeBot` 是通过逆向拿到的接口。

**实测这个 API 现在还活着**（2026-10-25）：

```
GET  https://dancedemo.shenghuayule.com/Dance/api/Common/GetQrCode
     → 200 { "ID": "LVFarm0eiG7...", "QrcodeUrl": "https://mp.weixin.qq.com/..." }

GET  (QrcodeUrl)
     → 200  image/jpg  37.6 KB      ← 微信二维码图

POST https://dancedemo.shenghuayule.com/Dance/token
     body: client_type=qrcode&grant_type=client_credentials&client_id=<ID>
     → 400 {"error":"unauthorized_client"}    ← 还没扫码
     → 200 { userId, access_token, refresh_token }   ← 扫码确认后
```

`DanceCubeBot` 最后一次 push 是 **2025-05**，一年半没更新，但接口没变。

## 二、登录方式和 Phigros 几乎一样

```
1. 拿一个 ID + 微信二维码 URL
2. 用户在微信里扫码确认
3. 每 4 秒轮询 POST /Dance/token
4. 200 就拿到 userId + access_token + refresh_token
```

**和 Phigros 的 TapTap 扫码是同一个模式** —— 手表出码、手机扫、轮询取 token。
所以 `pages/PhigrosLogin` 那套轮询逻辑**可以整个复用**，
换个接口、换个二维码来源就行。

⚠️ 差别：Phigros 的令牌是走 `X-Phigros-Session` 请求头，
舞立方是标准 OAuth 的 `Authorization: Bearer <access_token>`，
并且有 `refresh_token` 可以续期（`RefreshTokenJob.java` 就是干这个的）。

## 三、能拿到什么

| 接口 | 用途 |
|---|---|
| `/Dance/api/User/GetInfo?userId=` | 玩家信息（名字、等级、头像） |
| `/Dance/api/User/GetLvRatioHistory?userId=` | **Rating 历史**（画曲线用） |
| `/Dance/api/User/GetLastPlay` | 最近游玩 |
| `/Dance/api/User/GetMusicRankingNew` | 曲目排行 |
| `/Dance/api/User/GetMyRankNew?musicIndex=` | 自己某首的排名 |
| `/Dance/Music/GetMusicList` | 曲库 |
| `/Dance/MusicData/GetInfo?musicId=` | 单曲详情 |
| `/Dance/api/Common/Search?keyword=` | 搜索 |
| `/Dance/OAuth/GetMachineListByLocation?lng=` | 附近机台 |

**查用户信息/Rating/曲库 都需要 `Bearer` 令牌**（401）。

## 四、Rating 算法

`ratio/RatioCalculator.java` 里写着结构：

```
B15        = 最高分的 15 首
Recent 15  = 最近打的 15 首
合计       = B15 的平均 + Recent15 的平均
```

和舞萌的 B50（B35 + B15 + Recent）**同一个思路**，只是数量不同。

等级表（`AccGrade.java`）：

```
SSS_AP  100    SSS  98    SS  95    S  90
A        80    B    70    C   60    D   0
```

⚠️ **算法本身是数学，可以独立实现**；
但**代码是 GPL-3.0，不能直接抄**。要看逻辑可以，抄代码不行。

## 五、要做的活

| 工作 | 量 | 说明 |
|---|---|---|
| 服务端 `sources/dancecube.ts` | 中 | 登录 + 几个查询接口，照 `sources/osu.ts` 的结构写 |
| **登录页** | **小** | **直接复用 PhigrosLogin**，换接口 |
| core 的 `buildDanceCubeView` | 中 | B15 + Recent15 组装，照 `buildOsuBestsView` |
| 手表 B50 页加一种游戏 | 小 | 按 osu 的路子加分支 |
| 二维码渲染 | **待验证** | 见下面的风险 |

## 六、风险

### ① 手表要显示**微信**的二维码（最大技术风险）

`QrcodeUrl` 指向 `mp.weixin.qq.com`。手表上 `<image src>` 能不能直接加载远程图片，
**没验过**。

如果不行，方案是：**服务端把二维码图下载下来转 base64**，
手表只渲染本地数据 —— 多一次请求，但可控。

### ② 私有 API 随时可能变

现在能用，不等于以后能用。落雪至少是正规第三方查分站，
盛华这个是逆向出来的接口，**没有任何承诺**。

所以建议：**做成「如果挂了就整块隐藏」**，别让它拖垮其它游戏。

### ③ GPL-3.0

`DanceCubeBot` 是 GPL-3.0。我们的仓库如果开源，**不能包含它的代码**；
但**接口地址、参数名、算法逻辑**这些是事实，可以自己写一遍。
引用它的项目当参考资料没问题。

### ④ 微信扫码的门槛

舞立方玩家大概率都有微信 —— 这比 TapTap 的门槛还低。
但要确认：**扫码是不是需要关注公众号 / 授权**。从 `DanceCubeBot` 的代码看
只需要扫码确认，没有额外授权步骤。

---

## 七、我的建议

**做。** 理由：

1. 登录模式能复用 Phigros，**工作量比 osu 那次小**
2. 舞立方玩家群体和舞萌有重叠，是**现成的需求**
3. Rating 算法结构简单（B15 + Recent15）

**但先做一件事**：验证手表能不能显示那个微信二维码。
如果不通，就得改成「服务端转 base64」，工作量会多一块。

### 第一步（最小验证）

```
node .probe/dancecube-probe.mjs
```

跑一次完整流程：拿 ID → 打印二维码 URL → 轮询 token。
如果群里有人能扫一下，就能立刻确认整条链路通不通。

**这个验证做完之前，不建议动服务端代码。**
