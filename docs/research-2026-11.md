# 材料收集（2026-11-15）

给下一阶段做准备的调研。**都是我实际查证过的，来源附在每条后面。**

---

## 一、鸿蒙 Flutter 现状 —— 好消息

### 我们当前的版本能对上

```
我们的 Flutter     3.35.7
鸿蒙适配线有        3.35.7+ohos-1.0.4   ✅ 对得上
```

**不用降级。**

### 最新的适配线

| 上游 Flutter | 鸿蒙适配 | 备注 |
|---|---|---|
| **3.41.9** | `3.41.9+ohos-1.0.2` | 2026-09-30，Dart 3.11.5，最新 |
| **3.35.7** | `3.35.7+ohos-1.0.4` | **我们在用的这条** |
| 3.27.4 | `3.27.4+ohos-1.0.8` | |
| 3.22.3 | `3.22.3+ohos-1.1.5` | |
| 3.7.12 | `3.7.12-ohos-1.1.7` | 最老 |

来源：[华为开发者问答 - Flutter 鸿蒙版](https://developer.huawei.com/consumer/cn/forum/topic/0203228581357373133?fid=0109140870620153026)

### 关键事实

1. **官方 Flutter 没有 ohos 平台** —— 全靠社区适配
2. **仓库迁过**：原 `OpenHarmony-SIG` / `openharmony-tpc` 的 `flutter_flutter`，
   现在主要在 **CPF-Flutter** 组织下
   （来源：[掘金笔记](https://juejin.cn/post/7700647882441900073)）
3. **产物是 HAP**，不是 APK；平台目录叫 `ohos/`，原生侧写 **ArkTS**
4. **`flutter build hap`** 会去拉配套的引擎产物
5. **3.35 及以后引擎源码在仓库的 `engine/` 里**，不用单独克隆
6. **两套 SDK 不能同时在 PATH 里** —— 先出现的那个会接管全部命令

### ⚠️ 对我们的影响

- **业务 Widget / 状态 / 路由不用重写** —— Dart 层是通用的
- **要重写的是**：`android/` 换成 `ohos/`、平台通道（我们的 `astramai/bridge`、
  `astramai/dynamic_color` 两个 MethodChannel 都要在 ArkTS 侧重新实现）
- **插件要看有没有 ohos 版**：`flutter_web_auth_2`（登录）、`flutter_secure_storage`
  （存 token）、`shared_preferences`、`encrypt`（纯 Dart，没问题）

**这三个插件是鸿蒙上最大的风险点。** 要提前验证。

---

## 二、小米手环 Pro 的屏幕 —— 找到字号问题的根因了

### 规格

| 设备 | 屏幕 | 分辨率 | PPI |
|---|---|---|---|
| **小米手环 9 Pro** | 1.74" AMOLED | **336 × 480** | — |
| 小米手环 7 Pro | 1.64" AMOLED | 280 × 456 | 326 |

来源：[小米商城 - 手环 9 Pro 规格](https://www.mi.com/vn/product/xiaomi-smart-band-9-pro/specs/)、
[手环 7 Pro](https://www.mi.com/tw/product/xiaomi-smart-band-7-pro/)

### 🔑 我们的 `designWidth` 是 466

```json
"designWidth": 466
```

Vela 会按 `物理宽 / designWidth` 缩放所有 CSS px。

**于是：**

```
手环 9 Pro（336 宽）  缩放比 = 336 / 466 ≈ 0.72
  font-size: 22px  →  实际渲染 ≈ 15.9 物理像素

手表（466 宽）        缩放比 = 1.0
  font-size: 22px  →  实际渲染 = 22 物理像素
```

**同一行 CSS，在手环上比手表小 28%。**

**这就是「手环字太小看着费劲」的真正原因** —— 不是字号写小了，
是 `designWidth` 是按手表调的，手环上整体被缩了。

### 所以「可调字号」的正确做法

我之前做的 `font-scale.js` 默认 1.18 —— **不够**。

按上面的算法，手环要**约 1.39 倍**才能和手表的物理字号持平。

**更好的方案：默认档位按屏幕宽度算，而不是写死。**

```
scale = 466 / 设备逻辑宽度
  336 宽（手环 9 Pro） → 1.39
  480 宽（手表）        → 0.97 ≈ 1.0
```

Vela 能拿到屏幕宽度吗？`@system.device` 的 `deviceInfo` 里应该有
`screenWidth` / `windowWidth`。需要确认字段名。

### 布局影响

**只放大字号、不动 padding / 高度** 是安全的 —— 布局 px 也按同一比例缩，
所以比例关系不变；只有文字因为**有最小可读物理尺寸**才显得小。

⚠️ 但字号放大 39% 之后，**单行能放的字符会变少**，可能挤爆一些行。
要检查：

- B50 列表的曲名（现在 `max-lines: 1`）
- 设置页的 `row__label` + `row__mark` 同行
- 搜索结果的难度标签行

---

## 三、值得提前做的验证

| # | 验什么 | 为什么 |
|---|---|---|
| 1 | Vela 的 `@system.device` 能不能拿到屏幕宽 | 决定字号能不能自适应 |
| 2 | `flutter_web_auth_2` 有没有 ohos 实现 | 没有的话鸿蒙上登录要另写 |
| 3 | `flutter_secure_storage` 有没有 ohos 实现 | 没有的话 token 只能存明文（不可接受） |
| 4 | 小米手环 Pro 真的没有 fetch 吗 | 我们的整个网桥设计建立在这个假设上 |

第 4 条**最该先验** —— 万一 Pro 其实有 fetch（只是版本问题），
那整套网桥就是白做的。用户说「好像都支持」，这个「好像」值得确认。

---

## 四、顺带记下来的

- **落雪 Developer-Token 2027-01-01 停用**（之前调研的），
  新接入走 OAuth（client_id + client_secret + PKCE）。我们服务端现在
  用的还是 token，**明年之前要迁**。
- **Casdoor 的 `token_endpoint_auth_methods_supported` 包含 `none`** ——
  移动端纯 PKCE 是官方支持的，不需要把 secret 打进 APK。已实测通过。
