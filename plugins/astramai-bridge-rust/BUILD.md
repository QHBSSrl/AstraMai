# AstraMai 网桥（Rust 版）

> **基于**官方 FetchBridge 开发，不是直接用它。
>
> 上游：<https://github.com/AstralSightStudios/AstroBox-NG-Plugin-MiWear-InterconnectFetch>
> 协议：同上游（`PROTOCOL.md` 原样保留）

---

## 为什么 fork 而不是直接用

官方那版是**通用 fetch 代理**：任何 URL 都能转，协议覆盖 v1–v4
（单消息、分片、ACK 流控、压缩、流式、CRC32、重传、取消）。
它解决的是「所有不支持 fetch 的设备」的问题。

我们只需要服务 AstraMai 这一个应用，所以有改动的理由：

| | 官方 | 我们 |
|---|---|---|
| 维护方 | Searchstars | 自己 |
| 协议 | 通用 | 可能精简 |
| 品牌 | 网桥 FetchBridge | AstraMai 网桥 |
| 针对我们的优化 | 无 | 可以做（比如内置服务器地址、按接口选模式） |

**现在这一版只改了品牌和包名，协议完全一致** —— 先确保能编译、
能装上、能跑通，再考虑精简。别一上来就改协议，那样出问题分不清是哪边。

---

## 构建

### 需要什么

- **Rust**（已装，1.96.1）
- **`wasm32-wasip2` target**（已装）
- **一个能用的 host 链接器**

### ⚠️ 关于链接器 —— 这是这台机器上踩的坑

默认 toolchain 是 `stable-x86_64-pc-windows-msvc`，而这台机器
**没有装 MSVC / Visual Studio**，所以：

```
error: linker `link.exe` not found
```

试过的路：

| 尝试 | 结果 |
|---|---|
| `RUSTFLAGS="-C linker=rust-lld"` | ❌ 还是会找 MSVC 库 |
| 换成 `stable-x86_64-pc-windows-gnu` | ✅ **可行** |

GNU toolchain 本身就装着，只需要给它补 wasm target：

```bash
rustup target add wasm32-wasip2 --toolchain stable-x86_64-pc-windows-gnu
```

### 构建命令

```bash
cd plugins/astramai-bridge-rust

cargo +stable-x86_64-pc-windows-gnu build \
      --target wasm32-wasip2 --release
```

产物：`target/wasm32-wasip2/release/astramai_bridge.wasm`（1.4 MB）

### 打包

```bash
# 组装 dist/
cp target/wasm32-wasip2/release/astramai_bridge.wasm dist/astramai-bridge.wasm
cp manifest.json dist/
cp icon.png dist/

# 打 .abp（本质是 zip，只是扩展名不同）
zip -r astramai-bridge-0.1.0.abp dist/*
```

⚠️ PowerShell 的 `Compress-Archive` **不接受 `.abp` 扩展名**，
必须先打成 `.zip` 再改名。

---

## ⚠️ `wit/deps` 必须有

第一次编译报了一堆：

```
error[E0433]: cannot find `exports` in `crate`
error: cannot find macro `export` in this scope
```

原因：我只下载了 `wit/main.wit`，**漏了 `wit/deps/`**。
`wit-bindgen` 展开 world 时找不到 `astrobox:psys-host`，就什么都生成不出来，
于是 `exports` 和 `export!` 全都不存在。

`wit/deps/` 里那四个文件从我们自己那个 Python 插件的 `wit/deps/` 复制过来了
（内容是同一套 `astrobox:psys-host` 定义）。

---

## 当前的产物

```
plugins/astramai-bridge-rust/astramai-bridge-0.1.0.abp   722 KB
  ├─ astramai-bridge.wasm   1405 KB
  ├─ icon.png                273 KB
  └─ manifest.json
```

manifest：

```json
{
  "name": "AstraMai 网桥",
  "version": "0.1.0",
  "author": "AstraNexus",
  "website": "https://github.com/AstraNexusTech/AstraMai",
  "entry": "astramai-bridge.wasm",
  "wasi_version": 2,
  "api_level": 3,
  "permissions": ["thirdpartyapp","interconnect","register_interconnect_recv","register_card","device"]
}
```

wasm 里确认能搜到 `astramai` / `waki` / `fetch-stream` / `__hs__`。

---

## 下一步（按优先级）

1. **在真机上验证能装上、能握手、能查一次分**
   —— 这是最要紧的，别的都建立在它之上
2. 验证通过后再考虑**精简协议**：
   - 去掉 v4 流（我们可能用不上，单消息 + compact 端点就够）
   - 去掉压缩（蓝牙带宽没紧到那个程度）
   - 内置服务器基址（手表就不需要传完整 URL）
3. 如果精简了协议，手表端的 `fetchbridge.js` 也要同步改

---

## 和上游的关系

- 协议文档 `PROTOCOL.md` **原样保留**（上游的，52 KB）
- 源码是**上游的**，只改了 `Cargo.toml` 的包名和 `manifest.json` 的品牌
- 未来如果上游修了 bug，可以对照 diff 合并

如果哪天上游加了我们需要的东西（比如更好的流控），直接拉过来就行 ——
这也是「基于它开发」而不是「别写一个」的原因。
