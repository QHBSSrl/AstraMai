# AstraMai · Vela QuickApp 端

小米手表（Vela JS 应用）前端。目标设备：**REDMI Watch 5 eSIM**。
这是「先适配 eSIM 手表」这一步的落点。

## 与其他部分的关系

```
apps/vela  ──HTTP──▶  自建服务端（apps/server）  ──HTTPS──▶  落雪查分器
    │
    └── 复用 packages/core 的全部领域逻辑（打包成 src/common/astramai-core.js）
```

**开发者密钥不在端上。** 手表是端侧设备，密钥由服务端持有；端上只请求我们自己服务端的聚合接口，
一次拿到可直接渲染的视图模型——手表算力和流量都紧张，不适合端上拼装。

## 这是一个独立项目，不是 monorepo 的 workspace 成员

**这一点很重要，踩过坑。**

`aiot-toolkit` 检查的是「项目目录下有没有 `node_modules` 和 `aiot-toolkit`」。
如果 `apps/vela` 挂进根目录的 npm workspaces，依赖会被提升到仓库根，
`apps/vela/node_modules` 根本不会生成，IDE 会一直报：

```
2: 安装项目依赖 ❌
node_modules: 未安装
aiot-toolkit: 未安装
```

所以 `apps/vela` **刻意不在根 `package.json` 的 `workspaces` 里**，它有自己独立的
`package.json` 与 `package-lock.json`。

### 首次使用

```bash
cd apps/vela
npm install          # 装 aiot-toolkit，生成它自己的 node_modules
```

首次使用前还要先打包一次核心层（在仓库根目录）：

```bash
npm run build:core && npm run bundle:core
```

### 命令

| 命令 | 说明 |
| --- | --- |
| `npm run start` | `aiot start` —— 启动预览（会拉起模拟器/真机） |
| `npm run build` | `aiot build` —— 产出 `dist/*.rpk` |
| `npm run release` | `aiot release` —— 发布包 |
| `npm test` | 跑 `test/` 下的适配器单元测试 |

> 官方文档写的是 `aiot server`，但 2.0.5 的实际命令是 `aiot start`。

## 目录

```
apps/vela/
├── package.json / package-lock.json   独立项目，勿并入根 workspaces
├── test/vela-fetch.test.mjs           fetch 适配器的单元测试
├── dist/                              aiot build 产物（gitignore）
└── src/
    ├── manifest.json                  应用配置与路由
    ├── app.ux                         应用入口
    ├── common/
    │   ├── astramai-core.js           ← 由 npm run bundle:core 生成，勿手改
    │   ├── icon.png                   ← 由 npm run icon:vela 生成，占位图
    │   ├── vela-fetch.js              @system.fetch → core 的 FetchLike
    │   ├── api.js                     服务端地址 / 访问令牌 / B50 拉取
    │   └── store.js                   @system.storage 封装
    └── pages/
        ├── Index/index.ux             首页
        ├── Qr/qr.ux                   机台二维码
        └── B50/b50.ux                 Best 50
```

## 已实现

- **[核心层复用]** `packages/core` 打成一个 72 KB 的零依赖文件，端上直接 `import`。
- **[fetch 适配]** Vela 的 `@system.fetch` 是回调式、非 2xx 也走 success、
  没有 `Response.text()`。适配器把这些差异抹平，13 项单元测试覆盖
  （超时、竞态、同步抛错、错误码透传都测了）。
- **[二维码页]** 用 Vela 原生的 `<qrcode value="...">` 组件；
  **喂进去的是还原出的 84 字符短码，不是用户粘贴的链接**；有效期每秒重算。
- **[B50 页]** 好友码查询 + 概要 + 前 20 条列表。
- **[访问令牌]** 服务端设了 `API_TOKEN` 时，端上自动带 `X-API-Key`。

## 已经用真实工具链验证过的事

下面这些**不是猜测**，是在本机用 `aiot-toolkit@2.0.5` 实际构建通过之后确认的：

| 项 | 结论 |
| --- | --- |
| `npm install` 后 IDE 的两项检查 | `node_modules` ✅ / `aiot-toolkit` ✅ |
| `aiot build` | **成功**，产出 `dist/com.astranexus.astramai.debug.0.1.0.rpk`（66 KB） |
| `features` 名称 | 用 `--complete-feature` 反向验证：`system.fetch` / `system.storage` / `system.router` 一个不差 |
| `router` 的 key 写法 | 必须是 **`pages/Index` 这种带目录前缀的**，写成裸 `Index` 会报 `path 'src\Index\index.ux' does not exist` |
| 页面里的相对导入 | 必须是 `../../common/xxx.js`——页面在 `src/pages/<Page>/`，退一级是 `pages/`，退两级才是 `src/` |
| `router.path` | 编译进 RPK 的 manifest 里原样保留（`/`、`/qr`、`/b50`），`router.push({ uri: '/qr' })` 可用 |
| `icon` | **必填**，指向不存在的文件会直接构建失败（IDE 只报「项目无法启动」，不会说缺图标） |
| 签名 | debug 构建用工具箱自带的 pem，**不需要**自己准备 `sign/` |

## 调试笔记：黑屏的第一嫌疑是「平台模块在顶层 import」

模拟器里出现**纯黑屏、控制台一句有用的报错都没有**时，优先怀疑这个。

原因：`import systemFetch from '@system.fetch'` 这类**静态 import 会在页面模块初始化时
立刻解析平台模块**。设备/模拟器一旦不提供它，整个页面脚本初始化就抛错，
页面直接空白——而 `app.ux` 里没有 `onError` 的话，这个异常是**静默**的。

本工程的对策：

1. **平台模块一律延迟 `require()`**，写在函数体内（`store.js`、`api.js`、
   以及首页的 router 都是这么做的）。失败只影响那一个功能，不会拖垮整页。
2. **首页刻意不 import `api.js`**。首页只需要显示服务端地址，
   却会把 `@system.fetch` 拖进模块图——配置读取因此拆到了独立的 `config.js`。
3. **`app.ux` 里注册 `onError`**，把静默黑屏变成控制台里的一条报错。
4. 每个页面 `onInit` 都打了 `[AstraMai] Xxx onInit` 日志，
   用于判断「页面初始化有没有跑到」。

验证方式：解开 RPK 检查编译产物里 `@app-module/system.*` 的 require 是否落在函数体内，
而不是模块顶层。

## 调试笔记：黑屏的两个根因（都已修复）

模拟器里出现**纯黑屏、控制台没有任何应用日志**时，按下面的顺序排查。
这两个坑都实际踩过，而且**构建全程不报错**，只有在模拟器上看日志才能发现。

### 根因一：`app.ux` 必须有 `<script>` 标签

曾经把 `app.ux` 写成了裸的 ES module（直接 `export default {...}`，没有 `<script>` 包裹）。
构建照样成功，但**整段脚本被静默丢弃**——编译产物里 `$app_script$` 是个空函数：

```js
var $app_script$ = function __scriptModule__(module, exports, $app_require$1) {
    "use strict";
    "";                                          // ← 内容没了
};
$app_exports$.default.style = $app_style$;        // ← default 是 undefined，这里炸
```

运行时表现为 `TypeError: cannot read property 'style' of undefined` →
`init custom app inst error` → `Abort App...` → 黑屏。

**判断方法**：解开 RPK 看 `app.js`，如果你写的 `onCreate`/`onError` 字符串不在里面，
就是漏了 `<script>`。

### 根因二：`package.json` 里不能有 `"type": "module"`

**这条最隐蔽。**

`src/common/*.js` 由工具链的 Babel 转成 CommonJS（生成裸 `exports.xxx = ...`），
但 rspack 会根据 `package.json` 的 `"type"` 字段决定模块类型。
一旦写了 `"type": "module"`，rspack 把所有 `.js` 当 ESM 包装：

```js
"./src/common/astramai-core.js" (__unused_rspack___webpack_module__, __webpack_exports__, __webpack_require__) {
    Object.defineProperty(exports, "__esModule", { value: true });   // ← 裸 exports，未定义
```

参数名是 `__webpack_exports__`，函数体却用 `exports` → `ReferenceError: 'exports' is not defined`
→ 页面加载失败 → 黑屏。

副作用：手写成 CommonJS 的文件也一样挂（rspack 按 ESM 包装 → `module` 未定义）。

**所以 `apps/vela/package.json` 一定不要加 `"type": "module"`。**
代价是 Node 里 `.js` 默认按 CJS 加载，因此 `npm test` 用了
`node --experimental-default-type=module --test` 来保住对 ESM 源码的单元测试。

### 在模拟器上看应用日志

调试时最缺的是「应用到底报了什么」。模拟器是 **NuttX（NSH）**，不是 Android：
没有 `screencap`，`ps`/`grep` 也不同。但 **`dmesg` 里能看到 `[AIOTJS]` 的运行时输出**：

```bash
ADB="$USERPROFILE/.vela/sdk/tools/adb/win/adb.exe"

# 推送并解包（unzip -o 不会删除旧文件，先清理）
"$ADB" shell "rm -rf /data/quickapp/app/com.astranexus.astramai"
"$ADB" push dist/com.astranexus.astramai.debug.0.1.0.rpk /data/quickapp/app/com.astranexus.astramai.rpk
"$ADB" shell "unzip -o /data/quickapp/app/com.astranexus.astramai.rpk -d /data/quickapp/app/com.astranexus.astramai"

# 注意工作目录：相对路径 app/... 是相对 /data/quickapp 的
"$ADB" shell "cd /data/quickapp; vapp app/com.astranexus.astramai"

# 读日志（dmesg 缓冲很小，要尽快读）
"$ADB" shell "dmesg"
```

正常启动时应当看到：

```
[AIOTJS] [printFrmTraceInfo] PageLoad 1 / PageInit 1 / PageCreate 1
```

`PageCreate` 出现且**没有** `Abort App` 就说明页面起来了。
应用自己的 `console.log` 走的是 CDP 调试通道（`--jsdebugger`），
**不会**出现在 dmesg 里——所以 `console.log` 只在 IDE 的调试控制台可见。

### 两个工具链的坑（非本项目问题，但会浪费时间）

1. **`aiot build` 失败时退出码依然是 0。** 自动化脚本必须检查输出里的 `❌` / `build error`，
   否则会一路推着旧包，还以为是新代码没生效。
2. **`package.json` 带 BOM 会导致构建失败**，报错是
   `Unexpected token '', "..." is not valid JSON`。
   在 Windows 上用 PowerShell 的 `Set-Content -Encoding utf8` 改这个文件很容易写进 BOM。

## 输入法组件

**Vela 手表没有系统输入法**——`<input>` 获得焦点后不会弹出任何键盘，
所以文本输入必须由端上自绘。

我们使用第三方组件 [NEORUAA/Vela_input_method](https://github.com/NEORUAA/Vela_input_method)（MIT），
支持中文拼音、英文、日文罗马字。**日文是刚需**：maimai 曲名大量是日文，
没有它曲目搜索做不了。

- 代码位置：`src/components/InputMethod/`（91 个文件，约 297 KB）
- 来源与上游 commit 记录在 `src/components/InputMethod/NOTICE.md`
- 更新方式：`node scripts/vendor-input-method.mjs`（会重新抓取并刷新 NOTICE）
- **本地不修改该组件**，保持与上游一致，便于整体更新

在宿主 `manifest.json` 的 `features` 里需要声明（组件会用到的接口）：

```json
["system.fetch", "system.storage", "system.file", "system.vibrator", "system.device", "system.router"]
```

漏声明时构建会直接失败并报 `missing feature`，可以用 `aiot build --complete-feature`
让工具链算出完整列表，再把结果固化进源码（它只写进 RPK，不会改源码）。

### 事件语义（容易踩坑）

组件会同时发 `keyDown` 和 `complete`：

- `keyDown`：**每次按键**都发原始字符（拼音/罗马字模式下是「正在输入的字母」）
- `complete`：**真正提交文本**时发（选词确定后）

**只能监听 `complete`**，两个都监听会重复输入。
（上游自己的示例代码里也把 `keyDown` 注释掉了。）
删除用 `delete` 事件。

## 在模拟器上截图（调 UI 必备）

IDE 的预览窗口是隐藏的，模拟器又是 NuttX（没有 Android 的 `screencap`），
所以「界面到底渲染成什么样」一度只能靠猜。实际上 `/dev/fb0` 是可读的：

```bash
node scripts/vela-screencap.mjs [输出.png]
```

实测参数（**用像素值反推确认的，不是猜的**）：

- 分辨率 **432 × 514**，与 REDMI Watch 5 一致
- 格式 **RGB565 小端**（2 字节/像素）
  - 验算：页面底色 `#070b16` → `0x0042` → 小端字节 `42 00`，与实测字节吻合
  - 验算：卡片色 `#141d30` → `0x10E6` → `E6 10`，与实测字节吻合
- framebuffer 总大小是单帧的 2 倍（888192 = 432×514×2×2），只取第一帧

配套的 `scripts/vela-deploy.mjs` 一条命令完成「构建 → 部署 → 启动 → 读日志」。
两个脚本都支持 `VELA_ADB` / `VELA_DEVICE` 环境变量。

### 从模拟器读应用日志

模拟器是 **NuttX（NSH）**，不是 Android：没有 `screencap`，`ps`/`grep` 也不同。
但应用日志可以从内核日志里读出来：

```bash
"$ADB" shell "dmesg"
```

- 应用自己的 `console.log` 会以 **`[quickapp]`** 前缀出现（例如 `[quickapp] [AstraMai] B50 onInit`）
- 框架的输出带 **`[AIOTJS]`** 前缀，报错和 `PageLoad/PageInit/PageCreate` 统计都在这里
- **dmesg 缓冲很小**，且开机后 modem/RIL 会刷大量日志，
  所以要启动后立刻高频轮询抓取（见 `scripts/vela-deploy.mjs`）

正常的启动应当是：

```
[quickapp] [AstraMai] app onCreate
[AIOTJS] PageLoad 1 / PageInit 1 / PageCreate 1
```

出现 `Abort App` 就是页面没起来。

## 已知问题：导入自定义组件的页面不渲染内容

**未解决。** 症状与已确认的证据：

导入 `InputMethod` 的页面（B50、Search）**内容完全不渲染**，
去掉组件后不再报框架错误，但页面依然没有内容。

编译产物里能看到**页面根节点被写入了组件的内联样式**：

```js
// pages/B50/b50.js —— 这是【页面】的模板
app_template$ = function(vm) {
  return aiot.__ce__("div", {
    __opts__: {
      classList: ["page"],
      // ↓↓ 这段来自 InputMethod 组件的根节点，引用了组件才有的 prop
      style: () => $translateStyle$("flex-direction: column; height: " + (_vm_.hide ? "0px" : "auto") + ...)
```

`hide` 是组件的 prop，不是页面的。**页面根节点与组件根节点（都是 `<div class="page">`）
被编译器混在了一起。** 已排除的可能：

- 改页面根类名（`page` → `b50-page`）——无效
- 移除组件——不再报框架错误，但页面仍无内容（说明还有第二个原因）
- ViewModel 里用 getter —— 已改为普通字段，无效

下一步方向：确认 `<import>` 的正确放置位置（顶层 vs `<template>` 内）、
换成一个最小自定义组件复现、或不用自定义组件而把键盘直接内联进页面。

## 还没验证的部分

| 项 | 说明 |
| --- | --- |
| 运行时行为 | `@system.storage` 的方法名与回调签名、`<qrcode>` 的实际渲染 |
| 页面跳转 | 编译产物里的 path 是对的，但没在模拟器上点过 |
| 手表上的扫码 | 见下 |
| `designWidth` | 暂填 466，需按 REDMI Watch 5 的实际分辨率调整 |
| 包体积 | debug 构建未压缩，每个页面都内联了一份 core（约 170 KB/页）。`release` 构建会压缩，实际发布前需要复测 |

## 关于手表扫码：风险已大幅降低

一开始我把 ~400 字符的展示页链接当成了二维码内容，算出 **版本 15 / 77×77 模块**，
担心手表上模块太小扫不出来。

后来把官方生成的 PNG 下载下来、用独立解码器解了一遍，发现二维码内容其实是
**84 字符的短码**（`SGWCMAID…`），官方图像的编码参数是：

| 项 | 实测值 |
| --- | --- |
| 内容长度 | 84 字符 |
| 版本 / 模式 | 版本 4 / 字母数字模式 |
| 模块数 | **33 × 33** |
| 官方 PNG | 200×200 px，码区 198×198，每模块 **6 px** |

33×33 而不是 77×77——**每边少了 2.3 倍的模块**。在 REDMI Watch 5 这类
400px 级别的手表屏上，模块尺寸从约 3.9px 涨到约 10px 以上，可扫性完全不是一个量级。

**开发时务必用 `payload.content`（短码），不要用用户粘贴的链接原文**——
`src/pages/Qr/qr.ux` 里已经这么做了，那里也写了原因。
如果哪天有人改成直接喂链接，二维码会变成 77×77，在手表上直接不可用。

另外：**官方 PNG 的静区只有 1px**（规范要求 4 个模块）。我们这边留足了，不要照抄官方。

## 真机调试

1. 把 `src/common/api.js` 里的 `DEFAULT_SERVER_BASE` 改成可达的地址
   （局域网 IP，或经 frp 暴露的公网地址）；
2. 如果服务端设了 `API_TOKEN`，在应用里填同样的值；
3. **不需要**把服务端改成 `HOST=0.0.0.0`——frpc 与它同机时走 `127.0.0.1` 即可。
   只有 frpc 跑在别的机器上时才需要放开监听。
