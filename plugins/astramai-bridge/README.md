# AstraMai 网桥（AstroBox 插件）

把**手表上的 AstraMai** 和**查分服务器**接起来。

## 为什么需要它

手环（比如小米手环 10 Pro）的 Vela 运行时**没有网络能力**，只能用蓝牙跟手机通信。
AstroBox 装在手机上，插件跑在 AstroBox 里，于是：

```
Vela App（@system.interconnect，发 JSON 字符串）
     ↕
AstroBox 插件（本插件，跑在手机上，能上网）
     ↕ HTTP
我们的服务器（apps/server）
```

手表（REDMI Watch 5 eSIM）自己能上网，**不需要这个插件**。

## 构建

需要 Python 3 + `componentize-py`：

```bash
python -m pip install componentize-py==0.25.1
python scripts/build_dist.py              # 只构建 -> dist/plugin.wasm
python scripts/build_dist.py --package    # 顺便打 zip（改名 .abp 就是插件包）
```

产物约 **20 MB**（内嵌 CPython），宿主首次加载会预编译并缓存。

## 为什么用 Python 而不是 JavaScript

官方两种都支持，但 **JS 在 Windows 上编不动**：

- JS 插件依赖打过补丁的 ComponentizeJS，那个包要从源码构建
  （`make release`，会编译整个 SpiderMonkey）
- 而 Windows 上通常没有 `make`、没有 C++ 编译器、没有 VS Build Tools
- 装齐要好几个 GB，编译时间也很长

`componentize-py` 是**预编译 wheel**，`pip install` 完就能用。

（另外，官方 Python 模板的构建脚本调的是 `python -m componentize_py`，
那是个包、没有 `__main__`，会报错。本仓库的 `scripts/build_dist.py`
改成直接找 `componentize-py` 这个命令行程序。）

## 协议

### 手表 → 插件

```json
{ "id": "req-1", "action": "b50", "game": "maimai", "code": "123456789012345" }
```

`action` 目前支持：

| action | 说明 |
|---|---|
| `ping` | 只回 `{pong: true}`，不碰网络。用来验链路 |
| `b50`  | 查成绩，`game` 可选 `maimai` / `chunithm` |

### 插件 → 手表

**分片发送**（单条上限 `CHUNK_SIZE = 1800` 字符）：

```json
{ "id": "req-1", "seq": 0, "total": 3, "chunk": "{\"id\":\"req-1\",\"ok\":tru..." }
```

手表要按 `id` 收齐 `total` 片再拼成完整 JSON，然后解析：

```json
{ "id": "req-1", "ok": true, "data": { ...服务端的 data... } }
```

**为什么必须分片**：一份 B50 的 JSON 有十几 KB，而宿主没有告诉我们单条消息的上限。

## 安全边界

**插件里不碰任何上游密钥。** 它只把请求转发到我们自己的服务器，
密钥始终只在服务端（`apps/server` 的设计没变）。

## ⚠️ 还没验证的事

1. **宿主是否真的提供 `wasi:http` / `wasi:sockets`**
   —— 插件 wasm 里确实 import 了它们（构建产物可查），
   但宿主要实现它们才能实例化。**官方模板也一样 import，所以大概率没问题**，
   但没在真机上跑过。
2. **`interconnect-message` 事件的 payload 形状**
   —— 文档说「把收到的字符串原样作为 event-payload」，代码按这个写；
   如果实际是 `{addr, pkg, data}` 的 JSON 包装，需要改 `on_event`。
3. **单条消息的实际长度上限** —— `CHUNK_SIZE = 1800` 是猜的。
4. **`on_load` 时设备可能还没连上** —— 现在只在加载时订阅一次，
   如果那时没连上就不会订阅。可能需要监听设备连接事件后重订阅。

**验证顺序建议**：先发 `ping`（不碰网络），通了再试 `b50`。
