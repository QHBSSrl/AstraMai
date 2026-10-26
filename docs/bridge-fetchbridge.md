# 网桥：改用官方的 FetchBridge 插件

> 2026-10-26。**推翻了之前「借浏览器发请求」的做法。**
>
> 参考：<https://github.com/AstralSightStudios/AstroBox-NG-Plugin-MiWear-InterconnectFetch>
> （官方，作者 Searchstars，v1.3.2）

---

## 一、我错了：`wasi:http` 是可用的

之前我读 `wit/deps/astrobox-psys-host-v4.wit`，看到 19 个 interface 里没有 HTTP 客户端，
就断定「只能借浏览器」。**这个结论是错的。**

错在哪：我去数 `astrobox:psys-host-*` 这个**厂商包里**有什么，
但 `wasi:http` 是 **WASI 标准层**，不在那个文件里。

官方插件的 `Cargo.toml` 写着：

```toml
waki = "0.5.1"
```

`waki` 就是 **WASI HTTP 客户端的 Rust 绑定**。`src/fetch.rs` 里：

```rust
use waki::{Client, Method, Response};
...
let client = Client::new();
let response = req.send()...
```

**直接发 HTTP，没有浏览器，没有 WebView，没有弹窗。**

之前那个 `PermissionError: [Errno 2] Permission denied` 是 **`wasi:sockets`**（裸 TCP）被拒，
**不是** `wasi:http`。我把两者混为一谈了。

> **教训**：判断「宿主有什么能力」，要连 **WASI 标准接口**一起数，
> 不能只看厂商自己的 `psys-host` 包。

## 二、官方已经有一个做好的插件

| | |
|---|---|
| 名字 | **网桥 FetchBridge** |
| 版本 | 1.3.2 |
| 作者 | Searchstars（AstralSightStudios） |
| 体积 | 717 KB（wasm 1.5 MB） |
| api_level | 3，wasi_version 2 |
| 下载 | 已放进 `plugins/fetchbridge/FetchBridge-1.3.2.abp` |

它的定位就是「**让不支持 fetch 的小米穿戴设备通过 interconnect 恢复其等价能力**」——
和我们想做的一模一样。

### 它比我们想得远

我原来的分片方案是「1800 字符切片 + seq/total」，**没有流控**。

官方文档专门写了一节 **`⚠️ 关于分片死锁 (v2 → v3 的关键修复)`**：

> v2 的分片发送是**无流控**的：插件在一次 `on_event` 调用里用一个紧凑 `for` 循环把所有
> `fetch-chunk` 帧背靠背地灌进 QAIC/BLE 通道。响应一旦较大，帧产出速度远超手表侧的消费
> 速度；又因为插件在帧与帧之间**从不把控制权交还宿主**，宿主无法继续泵送底层传输——
> 发送队列被填满后永不排空，整笔传输**死锁**。

**这正是我们那套方案会遇到的问题。** 官方用 v3 的「累计 ACK + 滑动窗口」根治了它。

所以：**别自己造了，用它的。**

## 三、协议概要（我们要实现的是客户端这一侧）

传输：QAIC `interconnect` 通道，UTF-8 JSON 文本，一条消息一个 `tag`。

| tag | 方向 | 说明 |
|---|---|---|
| `__hs__` | 双向 | 握手 + 能力协商 |
| `fetch` | 双向 | 请求 / 响应（分片时只带头部） |
| `fetch-chunk` | 插件 → 设备 | 分片数据 |
| `fetch-ack` | 设备 → 插件 | 累计 ACK（v3 流控） |

**请求：**

```json
{
  "tag": "fetch",
  "id": "<请求 id>",
  "url": "https://example.com/api",
  "options": {
    "method": "GET",
    "headers": { "Accept": "application/json" },
    "body": "<字符串>"
  }
}
```

**响应（v1 单消息）：**

```json
{
  "tag": "fetch",
  "id": "<原 id>",
  "resp": {
    "ok": true, "status": 200, "statusText": "OK",
    "headers": { "content-type": "application/json" },
    "body": "<按 bodyEncoding 编码后的字符串>",
    "raw": false
  }
}
```

## 四、关键约束：单消息上限 **16 KB**

`src/fetch.rs`：

```rust
const MAX_UNCHUNKED_WIRE_LEN: usize = 16 * 1024;
```

超过就不发，直接返回错误（防止一个巨大 JSON 帧卡死 AstroBox UI）。

**而我们的 B50 现在有多大？我实测了：**

```
/api/maimai/b50/qq/<某个真实账号>
完整响应  88.6 KB
只有 data 88.5 KB
```

**88.6 KB，是上限的 5.5 倍。** 靠分片或压缩都绕不过去，除非先瘦身。

### 为什么这么大

单条成绩有 **32 个字段**：

```
score, songId, title, artist, genre, bpm, songVersion, songVersionTitle,
jacketUrl, aliases, type, levelIndex, difficulty, difficultyShort,
difficultyColor, level, levelValue, noteDesigner, notes, maxDxScore,
achievements, rate, dxScore, dxStar, fc, fs, rating, computedRating,
maxRating, headroom, verification, lastPlayedTime
```

手表真正用到的只有 **8 个**：
`title` / `levelValue` / `difficultyShort` / `achievements` / `rating` /
`dxScore` / `jacketUrl` / `type`。

`aliases`（别名数组）、`notes`（物量分项）、`computedRating` / `maxRating` /
`headroom`（推分计算用的中间值）、`verification`、`bpm`、`genre` 这些
**在手表上根本不显示**。

## 五、下一步（按成本从低到高）

### 方案 ①（推荐）：服务端出一个「瘦身」端点 + 走 v1 单消息

加 `GET /api/v1/maimai/b50/compact`，每首只回：

```json
{"t":"曲名","l":"14.2","d":"MASTER","a":100.5,"r":298,"dx":1234,"j":"封面URL","tp":"dx"}
```

估算：50 首 × ~90 字节 ≈ **4.5 KB**，**远低于 16 KB**。

好处：
- 手表端只需要实现 **v1 单消息**（几十行）
- **不用碰分片、不用碰 ACK、不用碰流控**
- 官方插件的复杂部分我们完全不碰

代价：
- 服务端多一个端点（但复用现有的 `buildB50View`，只是序列化时裁剪）
- 封面 URL 还是有点长，必要时可以只传曲目 id 让手表拼

### 方案 ②：走 v2 分片

要处理「先发头部再发 chunk」，但**没有流控会死锁**（官方明确警告）。
所以实际得直接上 v3。

### 方案 ③：自己写一个 Rust 插件

Rust 1.96.1 已装，`waki` 也能用。保留我们自己的
`{id, action:'http'}` 简单协议，只把网络层换成 `waki`。

**但分片和流控还是得自己写**，而这正是官方已经解决好的部分。
除非我们有官方插件做不到的需求，否则不划算。

---

## 六、已做的动作

- 下载了官方 `.abp`：`plugins/fetchbridge/FetchBridge-1.3.2.abp`（717 KB）
- 存了协议文档：`plugins/fetchbridge/PROTOCOL.md`（52 KB）
- 之前那个用 `browser.open` 的 Python 插件**作废**，不再维护

## 七、待确认

1. 官方插件的 **v1 单消息**路径，对 `raw=false` 的响应是直接给文本吗？
   （§5.1 说缺省 `bodyEncoding` 按 `raw` 推断：`raw=false` ⇒ `text`）
2. 手环上 `@system.interconnect` 发的字符串，**单条上限**是多少？
   （决定 `fetch` 请求本身会不会被截断 —— 请求通常很小，应该没问题）
3. 插件的 `api_level` 是 **3**，而我们快应用是 `minAPILevel 2` —— 确认兼容。
