# AstraMai API

服务端是一个**街机音游数据网关**：客户端只认下面这套协议，
背后接的是落雪查分器、还是以后别的源，由服务端决定。
**换源不需要客户端改代码。**

- 线上地址：`http://101.132.148.117:8787`
- 协议版本：v1

---

## 一、鉴权

由服务端的 `AUTH_MODE` 决定：

| 模式 | 行为 | 适用 |
| --- | --- | --- |
| `key` | 除 `/api/health` 外都要带访问令牌 | 私有部署 |
| `open` | 不校验令牌，靠限流约束 | **公开分发的 App** |

**为什么要有 `open`**：令牌写进客户端包里就不再是秘密，谁拿到 App 都能解出来。
那种情况下把令牌当门禁只是自欺欺人。公开分发的正确做法是
`AUTH_MODE=open` + 配好限流。

`key` 模式下三种写法都认：

```
Authorization: <token>
Authorization: Bearer <token>
X-API-Key: <token>
```

> `/api/health` **永远免鉴权**。客户端要先靠它判断「地址填对没有」，
> 而此时还没法保证令牌已经配好。

---

## 二、响应信封

成功：

```json
{
  "ok": true,
  "success": true,
  "mode": "live",
  "source": "lxns",
  "elapsedMs": 812,
  "data": { }
}
```

失败：

```json
{
  "ok": false,
  "success": false,
  "message": "查不到这个好友码对应的玩家，可能尚未在落雪同步过数据。",
  "error": {
    "kind": "not-found",
    "friendlyMessage": "……",
    "status": 404,
    "endpoint": "/api/v1/maimai/b50"
  }
}
```

`ok` 与 `success` 同时存在是刻意的：Web 前端读 `ok`，
`@astramai/core` 的 `unwrapEnvelope` 读 `success`（对齐落雪的信封），
这样 Vela 端可以直接复用同一个客户端。

### 错误码

| HTTP | kind | 含义 |
| --- | --- | --- |
| 400 | `bad-request` | 参数不对（好友码不是 15 位数字等） |
| 401 | `unauthorized` | 令牌缺失或错误（仅 `key` 模式） |
| 404 | `not-found` | 查不到该玩家 |
| 429 | `rate-limited` | 触发了限流，**或**本服务上游预算用尽 |
| 502 | `server` / `network` / `malformed` | 上游出错或返回无法解析 |
| 504 | `timeout` | 上游超时 |

`429` 有两种来源，`message` 会区分：
- 「请求太频繁，被落雪限流了」→ 上游限的
- 「服务器对落雪的调用已达每分钟上限」→ **我们自己**的上游预算用尽了

---

## 三、选择数据源

所有接口都接受 `?source=<id>`，不传则用默认源。
不认识的 id 会返回 400 并把可用列表写在 `friendlyMessage` 里。

```bash
curl 'http://101.132.148.117:8787/api/v1/sources'
```

```json
{
  "data": {
    "sources": [
      {
        "id": "lxns",
        "label": "落雪查分器",
        "games": ["maimai"],
        "requiresKey": true,
        "available": true,
        "isDefault": true
      }
    ]
  }
}
```

**不可用的源也会列出来**，并带 `unavailableReason`。
这样客户端能给出「服务端没配密钥」这种有意义的提示，
而不是拿到一个莫名其妙的报错。

---

## 四、接口

### `GET /api/v1`

协议自述。适合客户端启动时探一次，据此决定展示哪些功能。

### `GET /api/v1/sources`

见上。

### `GET /api/v1/maimai/b50`

Best 50 聚合结果，**服务端已经组装好，客户端拿到就能直接渲染**。

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `code` | 二选一 | 15 位好友码 |
| `qq` | 二选一 | QQ 号（部分源不支持） |
| `source` | 否 | 数据源 id |
| `mock` | 否 | `1` 时返回演示数据，不消耗上游配额 |

```bash
curl 'http://101.132.148.117:8787/api/v1/maimai/b50?code=123456789012345'
```

`data` 结构：

```json
{
  "player": {
    "name": "……", "rating": 16412, "friendCode": 123456789012345,
    "tier": { "label": "……" }, "trophy": { }, "icon": { }
  },
  "standard": [ { "title": "……", "difficultyShort": "MASTER", "levelValue": 14.0,
                  "achievements": 100.5, "rating": 325, "dxScore": 4321 } ],
  "dx": [ ],
  "stats": {
    "standardTotal": 12345, "dxTotal": 4067,
    "averageLevelValue": 13.42, "computedDelta": 0
  }
}
```

> `stats.standardTotal + stats.dxTotal` 应当等于 `player.rating`。
> `computedDelta` 是两者的差，服务端会自己校验——**不等于 0 说明公式或数据有问题**，
> 客户端可以据此显式提示，而不是默默展示一个错的数字。

### `GET /api/v1/maimai/player`

只要玩家信息，不做 B50 聚合。参数同上。

### `GET /api/v1/maimai/songs`

曲库。

| 参数 | 说明 |
| --- | --- |
| `notes` | `1` 时带上谱面详情（物量、谱师等），体积明显变大 |

曲库在服务端缓存（默认 6 小时），**命中缓存不消耗上游预算**。

### `GET /api/v1/maimai/search`

曲目搜索，匹配**曲名 / 艺术家 / 别名**三个维度。

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `q` | — | 关键词。日文曲名、中文别名、罗马音都能搜 |
| `limit` | 30 | 上限 200 |

```bash
curl --get --data-urlencode 'q=Grievous Lady' \
  'http://101.132.148.117:8787/api/v1/maimai/search'
```

```json
{ "data": { "keyword": "Grievous Lady", "count": 1, "results": [
  { "id": 1209, "title": "Grievous Lady", "artist": "Team Grimoire vs Laur",
    "aliases": ["病女", "伞对立", "对立拉窗帘"], "matchedBy": "title" } ] } }
```

`matchedBy` 取 `title` / `artist` / `alias`，客户端可以用它解释「为什么这条会被搜出来」。

### `GET /api/health`

免鉴权。用来判断地址填对没有。

```json
{ "data": {
  "mode": "live", "hasServerKey": true,
  "songCache": { "cached": true, "songCount": 1344, "ageMs": 129 },
  "upstreamBudget": { "lxns": { "limitPerMinute": 150, "usedThisMinute": 0, "remaining": 150 } },
  "accessControl": { "authMode": "key", "tokenRequired": true, "limitPerMinute": 120 }
} }
```

---

## 五、兼容性

`/api/maimai/*` 是历史路径，字段形态跟着落雪走，**保留它是为了不破坏已有客户端**
（Web 测试站和手表端都在用）。新接入请用 `/api/v1/*`。

`/api/maimai/*` 与 `/api/v1/maimai/*` 的曲库与搜索接口**是同一份实现**，
只是挂载了两条路径，所以行为不会漂移。

---

## 六、开发者：怎么加一个数据源

1. 在 `apps/server/src/sources/` 下新建文件，实现 `DataSource` 接口
   （见 `types.ts`）。照抄 `lxns.ts` 的结构即可。
2. 在 `apps/server/src/index.ts` 里 register：

   ```ts
   registry.register(new YourSource({ limiter: registry.limiterFor('your-id') }));
   ```

3. 需要的话把它设为默认：`registry.setDefault('your-id')`。

**路由和客户端都不用动。** 新源会自动出现在 `/api/v1/sources` 里，
也能通过 `?source=` 选中。

约定：

- **返回 `@astramai/core` 里归一化好的领域模型**，不要泄漏上游的字段结构
- **不要自己缓存**，缓存是服务端的关注点
- **发起请求前调用 `limiter.spend()`**，超限时它会抛出带友好文案的错误
- 拿不到密钥等情况要**如实反映在 `describe()` 的 `available` 上**，
  而不是让调用方拿到一个看不懂的报错
