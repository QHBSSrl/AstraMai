# AstraMai · Vela QuickApp 端

小米手表（Vela JS 应用）前端。这是「先适配 eSIM 手表」这一步的落点。

## 与其他部分的关系

```
apps/vela  ──HTTP──▶  自建服务端（apps/server）  ──HTTPS──▶  落雪查分器
    │
    └── 复用 packages/core 的全部领域逻辑（打包成 src/common/astramai-core.js）
```

**开发者密钥不在端上。** 手表是端侧设备，密钥由服务端持有；端上只请求我们自己服务端的聚合接口，
一次拿到可直接渲染的视图模型——手表算力和流量都紧张，不适合端上拼装。

## 目录

```
apps/vela/
├── package.json
├── test/vela-fetch.test.mjs      fetch 适配器的单元测试（可在 Node 里跑）
└── src/
    ├── manifest.json             应用配置与路由
    ├── app.ux                    应用入口
    ├── common/
    │   ├── astramai-core.js      ← 由 npm run bundle:core 生成，勿手改
    │   ├── vela-fetch.js         @system.fetch → core 的 FetchLike
    │   ├── api.js                服务端地址配置 + B50 拉取
    │   └── store.js              @system.storage 封装
    └── pages/
        ├── Index/index.ux        首页
        ├── Qr/qr.ux              机台二维码
        └── B50/b50.ux            Best 50
```

## 已实现

- **[核心层复用]** `packages/core` 打成一个 72 KB 的零依赖文件，端上直接 `import`。
  `calculateDxRating`、`buildB50View`、`parseWahlapQrPayload`、`describeValidity`
  等全部可用。
- **[fetch 适配]** Vela 的 `@system.fetch` 是回调式、非 2xx 也走 success、
  没有 `Response.text()`。适配器把这些差异抹平，并有 13 项单元测试覆盖
  （超时、竞态、同步抛错、错误码透传都测了）。
- **[二维码页]** 用 Vela 原生的 `<qrcode value="...">` 组件；
  **喂进去的是还原出的 84 字符短码，不是用户粘贴的链接**；有效期每秒重算。
- **[B50 页]** 好友码查询 + 概要 + 前 20 条列表。
- **[访问令牌]** 服务端设了 `API_TOKEN` 时，端上自动带 `X-API-Key`。

## 还没做 / 需要真机确认的部分

这些我**没有**在真实工具链上验证过，因为本仓库里没有 Vela 的 IDE / 模拟器：

| 项 | 状态 |
| --- | --- |
| `manifest.json` 里 `features` 的名称 | `system.fetch` 已由官方文档确认；`system.storage`、`system.router` 待确认 |
| `router.push({ uri })` 的路径写法 | 官方两份文档里 `pages` 与 `Pages` 大小写不一致，本工程改用 manifest 显式声明的 `path` |
| `@system.storage` 的方法名与回调签名 | 收在 `store.js` 一处，对不上只改这一个文件 |
| `designWidth` | 暂填 466，需按 REDMI Watch 5 的实际分辨率调整 |
| `<qrcode>` 对 84 字符内容的实际渲染 | 见下，风险已大幅降低但仍建议上机扫一次 |
| `setInterval` 在页面 `onHide` 后是否真的停止 | 已显式 `clearInterval`，但手表上的后台行为需实测 |

## 最大的风险：一度以为手表扫不出来，实测后基本解除

一开始我把那个 ~400 字符的展示页链接当成了二维码内容，算出 **版本 15 / 77×77 模块**，
担心手表上模块太小扫不出来。

后来把官方生成的 PNG 下载下来、用独立解码器解了一遍，发现二维码内容其实是
**84 字符的短码**（`SGWCMAID…`），官方图像的编码参数是：

| 项 | 实测值 |
| --- | --- |
| 内容长度 | 84 字符 |
| 版本 / 纠错 | 版本 4 / 字母数字模式 |
| 模块数 | **33 × 33** |
| 官方 PNG | 200×200 px，码区 198×198，每模块 **6 px** |

33×33 而不是 77×77 —— **每边少了 2.3 倍的模块**。在 REDMI Watch 5 这类
400px 级别的手表屏上，模块尺寸从约 3.9px 涨到约 10px 以上，可扫性完全不是一个量级。

所以这件事从「必须真机验证的高风险项」降级为「大概率没问题，但上机扫一次确认」。

**开发时务必用 `payload.content`（短码），不要用用户粘贴的链接原文**——
`apps/vela/src/pages/Qr/qr.ux` 里已经这么做了，那里也写了原因。
如果哪天有人改成直接喂链接，二维码会变成 77×77，在手表上直接不可用。

另外一点：**官方 PNG 的静区只有 1px**（规范要求 4 个模块）。
我们这边渲染时留足，不要照抄官方。

## 开发

```bash
# 在仓库根目录
npm run build:core          # 编译 packages/core
npm run bundle:core         # 打包给 Vela 用的单文件
npm test                    # core / server / vela 的全部测试

# 真机/模拟器
# 用 Vela IDE 打开 apps/vela，或把 src/ 拷进 IDE 生成的项目里
```

目标设备：**REDMI Watch 5 eSIM**（在官方 `system.fetch` 支持列表内）。

真机调试时：

1. 把 `src/common/api.js` 里的 `DEFAULT_SERVER_BASE` 改成可达的地址
   （局域网 IP，或经 frp 暴露的公网地址）；
2. 如果服务端设了 `API_TOKEN`，在应用设置里填同样的值；
3. **不需要**把服务端改成 `HOST=0.0.0.0`——frpc 与它同机时走 `127.0.0.1` 即可。
   只有 frpc 跑在别的机器上时才需要放开监听。
