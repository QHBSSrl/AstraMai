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

- **[核心层复用]** `packages/core` 打成一个 71 KB 的零依赖文件，端上直接 `import`。
  `calculateDxRating`、`buildB50View`、`parseWahlapQrPayload`、`describeValidity`
  等全部可用。
- **[fetch 适配]** Vela 的 `@system.fetch` 是回调式、非 2xx 也走 success、
  没有 `Response.text()`。适配器把这些差异抹平，并有 13 项单元测试覆盖
  （超时、竞态、同步抛错、错误码透传都测了）。
- **[二维码页]** 用 Vela 原生的 `<qrcode value="...">` 组件；有效期每秒重算。
- **[B50 页]** 好友码查询 + 概要 + 前 20 条列表。

## 还没做 / 需要真机确认的部分

这些我**没有**在真实工具链上验证过，因为本仓库里没有 Vela 的 IDE / 模拟器：

| 项 | 状态 |
| --- | --- |
| `manifest.json` 里 `features` 的名称 | `system.fetch` 已由官方文档确认；`system.storage`、`system.router` 待确认 |
| `router.push({ uri })` 的路径写法 | 官方两份文档里 `pages` 与 `Pages` 大小写不一致，本工程改用 manifest 显式声明的 `path` |
| `@system.storage` 的方法名与回调签名 | 收在 `store.js` 一处，对不上只改这一个文件 |
| `designWidth` | 暂填 466，需按目标手表分辨率调整 |
| `<qrcode>` 对 ~400 字节内容的实际表现 | **最大的风险点，见下** |

## 最大的风险：手表屏幕上这个码扫得出来吗

机台二维码的内容实测是 **399 字节**，编码后是 **版本 15 / 77×77 模块**。
在手表上按 300px 显示，每个模块只有约 3.9px。

- 模块太小 → 机台扫不出来
- 把码放大 → 超出表盘，同样扫不全

这不是靠改代码能绕过的，**必须真机试**：拿一台目标手表，把真实二维码显示出来，
到机台上扫一次。如果扫不出来，可选的应对方向：

1. 用 EC 等级 `L` 而不是 `M`（容量更大 → 版本更小 → 模块更大），代价是容错率降低；
   实测 L 等级下同一内容是版本 13（69×69），模块可以大 12%。
2. 让机台扫码时手表亮度拉满、并提示用户保持静止。
3. 如果都不行，就说明这个功能在手表形态上不成立，应该考虑改由手机侧出示二维码，
   手表只做「查分」——这需要在做更多投入之前先确认。

## 开发

```bash
# 在仓库根目录
npm run build:core          # 编译 packages/core
npm run bundle:core         # 打包给 Vela 用的单文件
npm test                    # core 与 vela 的全部测试

# 真机/模拟器
# 用 Vela IDE 打开 apps/vela，或把 src/ 拷进 IDE 生成的项目里
```

真机调试时记得：

1. 把 `src/common/api.js` 里的 `DEFAULT_SERVER_BASE` 改成电脑在局域网里的地址；
2. 服务端要以 `HOST=0.0.0.0` 启动（默认只监听 127.0.0.1，手表连不上）；
   注意这样会把服务暴露到局域网，仅在可信网络下这么做。
