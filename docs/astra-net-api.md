# 自建 net 的 API 契约

> 目标：把**我们自己部署的 net** 接成一个 `DataSource`，和落雪并列。
> 玩家在设置里选源；两条通路（接入私服 / 从别处导入）最终都表现为**同一个数据源**。

本文是**实测出来的**，不是照着文档抄的。验证对象是 AquaDX 官方公开实例
`aquadx.net`（AquaDX 自带的前端 AquaNet 就部署在那里）。

---

## 一、我们不需要自己设计 API

**AquaDX 自带的 AquaNet 已经是一套完整的 HTTP API**，而且它**就是我们的 net**
（自建时跑的是同一份代码）。所以适配器直接对着这套接口写即可。

### 部署形态

AquaNet 的 nginx 配置：

```nginx
location / {
  root /var/www/html/AquaNet/;     # 前端
  try_files $uri $uri/ @router;
}
location /aqua/ {                   # ★ API 后端
  proxy_pass http://127.0.0.1/;     # AquaDX
}
```

**所以 API 基址是 `{站点}/aqua`**，不是 `/api/v2`。

> ⚠️ 实测踩过：直接打 `https://aquadx.net/api/v2/...` 全部返回 **405**，
> 因为那是前端路由，不是后端。加上 `/aqua` 前缀才通。

### 调用格式（三个容易搞错的地方）

| | |
|---|---|
| 方法 | **POST**（几乎所有接口） |
| 参数位置 | **查询字符串**，不是请求体 |
| 鉴权 | `token` 作为**查询参数**，不是 header |

依据是 AquaNet 自己的 `post()`：

```ts
export function fetchWithParams(input, init) {
  return fetch(reconstructUrl(input, u => {
    u.search = new URLSearchParams(init?.params ?? {}).toString()
  }), init)
}
```

例外：`import` / `import-music-detail` / `transfer` 用 JSON 请求体。

---

## 二、我们要用到的端点

| 用途 | 端点 | 鉴权 |
|---|---|---|
| 玩家摘要（**含 B50 组成**） | `POST /aqua/api/v2/game/{game}/user-summary?username=` | 否 |
| Rating 趋势 | `POST /aqua/api/v2/game/{game}/trend?username=` | 否 |
| 各游戏存档概况 | `POST /aqua/api/v2/card/user-games?username=` | 否 |
| 曲库元数据 | `GET  {DATA_HOST}/d/{game}/00/all-music.json` | 否 |
| 封面 | `GET  {DATA_HOST}/d/{game}/music/00{id}.png` | 否 |
| 当前用户 | `POST /aqua/api/v2/user/me` | **是** |
| 导出存档 | `POST /aqua/api/v2/game/{game}/export` | **是** |
| 导入存档 | `POST /aqua/api/v2/game/{game}/import`（JSON 体） | **是** |

**`game` 取值**：`mai2`（舞萌 DX）、`chu3`（中二节奏）、`ongeki`、`wacca`。

> ✅ **成绩导入不用我们做。** `export` / `import` 是 AquaDX 自带的，
> 「从其它查分器导出数据」这条通路在 net 那边就闭环了。

---

## 三、B50 数据在哪

`user-summary` 返回 `GenericGameSummary`，其中 `ratingComposition` 是关键。

### ⚠️ 两个「想当然就会错」的地方（实测推翻了假设）

**一、键不是 `best50`，是 `best35` + `new15`。**

对着官方实例抓真实响应，`ratingComposition` 的键只有两个：

```
ratingComposition 键: best35, new15
```

（`UserHome.svelte` 里还引用了 `best50` / `best30` / `recent10` 等，
但**线上实例的 maimai 只给 best35 + new15**。所以映射要**按实际拿到的键来处理**，
不能硬编码某一个。）

**二、值不是数组，是逗号分隔的字符串。**

```
best35 (string, 746 字符)  ← 不是 string[]
"11663:4:24015:1005324,11662:3:24008:1008814,..."
 └ 按 "," 分割 = 35 段      ← 正好 B35
new15  (string, 329 字符)  ← 15 段，正好 B15
```

### 元素格式

```
mai2 :  "musicId:level:romVersion:achievement"
chu3 :  "musicId:diffId:score"
```

miamai 那项多一个 `romVersion`，**解析时要丢掉**——依据是 `scoring.ts`：

```ts
const mapData = item.split(':').map(Number)
if (game === 'mai2') mapData.splice(2, 1)   // ← 丢掉 romVersion
const [musicId, diffId, score] = mapData
```

`achievement` 是**整数**：`1005324` ≈ `100.5324%`。

实例数据印证：

```
best35[0] = "11663:4:24015:1005324"
             musicId=11663  level=4(Re:M)  romVersion=24015(丢)  achievement=1005324

new15[0]  = "19255:3:90033:1005534"
             musicId=19255 ≥ 10000 → DX 谱面 ✓ 与第四节的 ID 规则一致
```

### 对应关系

| net 的键 | 我们的字段 |
|---|---|
| `best35` | `MaimaiBests.standard`（B35） |
| `new15` | `MaimaiBests.dx`（B15） |
| 两者合起来 | **B50** |

`best35` + `new15` 正好合成 B50，**与现有视图无需任何改动**。

### 另外拿得到的东西

`recent` 有 **100 条**完整游玩记录，字段比落雪还全：

```
musicId, level, achievement, isFullCombo, isAllPerfect,
deluxscore, afterRating, beforeRating, maxCombo, playDate, ...
```

`ranks` / `detailedRanks` 是评级分布，`favorites` 是收藏曲。

### 「没有数据」的信号是 404

实测用同一用户名查 `chu3`：

```
POST /api/v2/game/chu3/user-summary?username=OHOOO  →  404  "Game data not found"
```

也就是**这个玩家在该游戏没有存档**。适配器要把它转成友好文案，
而不是当成「服务器出错」。


---

## 四、`type`（STD / DX / 宴会场）从 ID 推

**合成字符串里没有谱面类型**，但舞萌的曲目 ID 自带：

```
< 1000        704 首    standard
1000 – 9999    11 首    （少量历史曲目）
10000 – 19999 1034 首   dx        （= 基础 ID + 10000）
>= 20000      152 首    utage     （如 600429 = [宴]Wonderland Wars）
```

判定规则：

```ts
if (id >= 100000 || id >= 20000) type = 'utage';
else if (id >= 10000)            type = 'dx';
else                             type = 'standard';
```

---

## 五、曲库元数据

`all-music.json` 是一个**以 musicId 为键的字典**（不是数组）：

```json
{
  "8": {
    "name": "True Love Song",
    "ver": "Ver1.00.00",
    "composer": "Kai/クラシック「G線上のアリア」",
    "genre": "maimai",
    "utageKanjiName": "",
    "notes": [{ "lv": 5 }, { "lv": 7.2 }, { "lv": 10.2 }, { "lv": 12.4 }]
  }
}
```

实测规模：`mai2` 1901 首、`chu3` 2258 首。

> ⚠️ `chu3` 的 `genre` 可能是 `null`，`notes[].lv` 可能为 `0`。
> 这些都要在映射时兜底，不能让界面显示 `undefined`。

---

## 六、和落雪的差异（决定了适配器怎么写）

| | 落雪 | 我们的 net |
|---|---|---|
| 玩家标识 | 好友码 / QQ 号 | **用户名**（`username`） |
| 查别人 | 一把密钥查任何人 | `user-summary` **无需鉴权**，可查任何人 |
| 查自己 | 同上 | 加 `token` 可拿到额外数据（候选曲等） |
| 鉴权位置 | `authorization` 头 | `token` **查询参数** |
| 成绩来源 | 独立的 B50 接口 | 摘要里的 `ratingComposition` |

**关键结论**：因为 `user-summary` 无需鉴权，「像落雪那样查任何人」是可行的 ——
只是把「好友码」换成「用户名」。

---

## 七、要改的地方（服务端）

1. `PlayerQuery` 加 `username?: string`
2. `DataSource.getBests(friendCode: number)` → **`getBests(query: PlayerQuery)`**
   —— 现在这个签名是落雪的形状（先取 player 再拿 `friend_code`），
   我们的 net 没有好友码，硬套会别扭。改完两边都能自然表达。
3. 新增 `apps/server/src/sources/astra-net.ts`
4. 在 `index.ts` 里按配置注册（没配地址就不注册，`/api/v1/sources` 不列出）
