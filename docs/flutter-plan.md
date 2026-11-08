# Flutter 三端方案（Android / iOS / 鸿蒙）

> 2026-11-08 决定。**Capacitor 排除**，Kotlin 因多平台麻烦排除。
>
> 目标：Android + iOS + HarmonyOS NEXT 三端，一套代码。

---

## 一、先说清楚鸿蒙的真实情况

**鸿蒙不是 Flutter 官方支持的平台。** 官方只支持 Android / iOS / Web / Linux / macOS / Windows。

鸿蒙靠的是 **OpenHarmony 社区维护的 SDK fork**：

- [flutter_flutter（OpenHarmony SIG）](https://atomgit.com/oh-flutter/flutter_flutter)
- 文档：[Flutter for OpenHarmony](https://github.com/SMDegz/HarmenyFlutterDoc)

**关键限制（必须提前知道）：**

| 限制 | 说明 |
|---|---|
| **版本落后** | 鸿蒙适配的是 **3.27 / 3.35**，而 Flutter 上游已经到 3.44 |
| **要换 SDK** | 打包鸿蒙时不能用手上的标准 Flutter，得换成 SIG 的 fork |
| **插件生态** | 纯 Dart 的库没问题；**带平台原生代码的插件**（分享、通知、相机）需要 ohos 版本 |

### 对我们的影响

我们的依赖里，**大部分是纯 Dart**：

| 用途 | 选型 | 三端通吃？ |
|---|---|---|
| 网络 | `dio` / `http` | ✅ 纯 Dart |
| JSON | `json_serializable` | ✅ 纯 Dart |
| 图片 | `cached_network_image` | ✅ 纯 Dart |
| 状态 | `provider` / `riverpod` | ✅ 纯 Dart |
| 本地存储 | `shared_preferences` | ⚠️ 需要 ohos 版（有） |
| 分享成绩图 | `share_plus` | ⚠️ 要看 ohos 支持 |
| 本地通知 | `flutter_local_notifications` | ❌ 大概率没有 ohos 版 |

**所以策略是：核心功能只用纯 Dart 库，平台相关的功能做成可选（鸿蒙上降级掉）。**

---

## 二、为什么最终选 Flutter

### 排除 Capacitor

用户明确排除。而且理由成立 —— 网页套壳的原生感差，通知/分享/文件这些要另外写插件。

### 排除 Kotlin

| | Kotlin |
|---|---|
| Android | ✅ 最好 |
| iOS | ❌ 要 KMP，UI 得用 Compose Multiplatform（还在 alpha） |
| 鸿蒙 | ❌ 要另写 ArkTS |

**三端 = 三套代码**，这正是用户说的「太麻烦」。

### Flutter 的取舍

| | Flutter |
|---|---|
| Android | ✅ |
| iOS | ✅ |
| 鸿蒙 | ⚠️ 社区 fork，版本受限 |
| 性能 | **够用**（见下） |
| 包体积 | ~20 MB（Kotlin ~8 MB） |
| 一套代码 | ✅ |

### 关于「性能不如 Kotlin」

**这个 App 不需要极限性能。** 它做的是：

- 发 HTTP 请求（网络延迟 >> 渲染开销）
- 解析 JSON（几 KB 到 100 KB）
- 滚动 50 条成绩列表
- 加载封面图
- 算 Rating（纯算术）

**这些 Flutter 跑 60fps 毫无压力。** 真正吃性能的是游戏渲染、大量自定义动画、像素级绘制 —— 我们一个都不沾。

**包体积大 12 MB 是唯一的实际代价**，换来的是三端一套代码。

---

## 三、架构

```
apps/flutter/
  lib/
    main.dart
    app.dart
    core/                    ← 移植 packages/core 的逻辑
      models.dart            数据模型（对服务端视图模型）
      api_client.dart        HTTP 封装（dio）
      endpoints.dart         接口路径
      rating.dart            DX Rating 计算
      tier.dart              段位表
      qr_encoder.dart        QR 码生成（机台二维码，纯 Dart）
    features/
      b50/                   B50 页
      search/                曲目搜索
      push/                  推分计算器
      diff/                  成绩对比
      settings/              设置
    ui/
      theme.dart             配色（和手表/web 一致）
      widgets/               共用组件
```

### 服务端不变

**`apps/server` 继续用。** 它已经把落雪/中二/Phigros/osu 的原始响应归一化成
视图模型，客户端只管渲染。所以 Flutter 端**不需要理解上游字段**。

### 需要移植的 core 逻辑

| 模块 | 行数 | 是否必须 |
|---|---|---|
| `maimai/` | 1566 | ✅ Rating / B50 组装 / 段位 |
| `qr/` | 697 | ✅ 机台二维码生成 |
| `lxns/` | 893 | ⚠️ 大部分是 API 契约，服务端做了，客户端可以砍 |
| `chunithm/` | 346 | ✅ |
| `phigros/` | 453 | ✅ |
| `osu/` | 300 | ✅ |
| `dancecube/` | 313 | ✅ |
| `util/` | 127 | ✅ |

**合计约 4700 行 TS → Dart。** 但很多是类型定义和 API 契约，可以直接删掉
（服务端已经做了归一化）。

**真正要手写的估计 1500–2000 行。**

---

## 四、第一版范围（按用户要求：手表功能 + 手机独有能力）

### 搬过来的（手表已有）

- 四个游戏查分：舞萌 B50 / 中二 B30 / Phigros RKS / osu Best Plays
- 曲目搜索（日文/别名/罗马音）
- 推分计算器
- 成绩对比（涨/跌/新进/掉出）
- 离线缓存
- 距下一档
- 机台二维码

### 手机独有的

- **登录态持久保存**：Phigros 的 TapTap token / 舞立方的微信 token 存本地，不用每次登录
- **成绩历史曲线**：每次查分存一份快照，画 Rating 变化曲线（手表存不下这个）
- **分享成绩图**：生成长图分享到群里
- **本地通知**：Rating 变化提醒、新版本提醒
- **多账号**：同时存自己和朋友的

---

## 五、环境状态

| 组件 | 状态 |
|---|---|
| JDK 21 | ✅ `D:\Minecraft\MCServer\zulu21` |
| Android SDK | ✅ `D:\AndroidSDK`（platform 35 / build-tools 35.0.0 / adb 1.0.41） |
| Flutter SDK | ⏳ 下载中（`D:\flutter-sdk\flutter.zip`） |
| iOS 工具链 | ❌ **需要 Mac**（这台是 Windows） |
| 鸿蒙 SDK | ❌ 还没装（要先装 DevEco Studio + OpenHarmony SIG 的 Flutter fork） |

### 关于 iOS

**Windows 上编译不了 iOS。** 要么：
- 借一台 Mac（最省事）
- 或者先用 Flutter 做 Android + 鸿蒙，iOS 等有机器再打

**代码不用改** —— Flutter 的 iOS 支持是开箱的，只是需要 Mac 上跑 `flutter build ios`。

---

## 六、下一步

1. 等 Flutter 下完 → 解压 → `flutter doctor` 确认 Android 环境通
2. `flutter create` 建项目
3. 先做**舞萌 B50**（打通端到端）
4. 再补其它三个游戏
5. 最后做手机独有的功能
