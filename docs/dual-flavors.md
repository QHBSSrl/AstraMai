# 两个包体（手表 / 手环 Pro）

> 手环 Pro 没有 `@system.fetch`，必须靠手机中转联网；手表系列自带联网能力，
> 用不上网桥。**所以分两个包，装哪个就是哪类设备，不用在运行时猜型号。**

---

## 一、对应关系

| | 手表版（std） | 手环版（band） |
|---|---|---|
| **手机 App 包名** | `com.nowmes.orhythm` | `com.nowmes.orhythm.band` |
| **快应用 package** | `com.nowmes.orhythm` | `com.nowmes.orhythm.band` |
| **网桥入口** | 不显示 | 显示 |
| **签名证书** | 同一张 | 同一张 |

**⚠️ 手机包名和快应用 package 必须逐字符一致**，否则 interconnect 连不上，
而且不给有用的错误（现象是「握手超时」）。

---

## 二、怎么打包

### 一步到位（推荐）

```bash
npm run apk:std     # 手表版：切 package → 打 APK
npm run apk:band    # 手环版：切 package → 打 APK
```

这两个命令会先调 `scripts/vela-package.mjs` 把 `apps/vela/src/manifest.json`
的 `package` 切对，然后打对应 flavor 的 APK。

### 分开做

```bash
# 看当前是哪个
npm run pkg:show

# 切到手表版
npm run pkg:std
cd apps/flutter && flutter build apk --flavor std

# 切到手环版
npm run pkg:band
cd apps/flutter && flutter build apk --flavor band
```

### 产物

```
apps/flutter/build/app/outputs/flutter-apk/
  app-std-debug.apk     手表版
  app-band-debug.apk    手环版
```

快应用（RPK）在 `apps/vela/dist/`，包名跟着 `manifest.json` 走。

**⚠️ 打 RPK 之前一定要先切 package** —— 忘了的话 APK 和 RPK 包名对不上，
装上去就是连不通。

---

## 三、为什么不在运行时判断设备

试过，不可行：

| 手段 | 问题 |
|---|---|
| `Node.name` | 是**用户自己设的设备名**，可能是「我的手表」 |
| `getConnectedNodes()` 的 id | 不包含型号信息 |
| 让快应用自报型号 | 要改协议、要等手表先连上才能判断 |

**猜错的代价不对称：**

- 把 Pro 用户误判成非 Pro → **他完全看不见入口**，Web 上又没法开
- 把非 Pro 误判成 Pro → 只是多一个用不上的入口

所以干脆分包。**装哪个包，就是哪类设备。**

---

## 四、实现细节

### Gradle flavor

```kotlin
flavorDimensions += "device"

productFlavors {
    create("std") {
        dimension = "device"
        // applicationId 保持 com.nowmes.orhythm
        buildConfigField("boolean", "BRIDGE_ENABLED", "false")
    }
    create("band") {
        dimension = "device"
        applicationIdSuffix = ".band"
        buildConfigField("boolean", "BRIDGE_ENABLED", "true")
    }
}
```

### Dart 侧读开关

`BRIDGE_ENABLED` 通过 MethodChannel 的 `features` 方法暴露给 Dart：

```dart
await BridgeChannel.loadFeatures();   // main() 里调一次
...
if (BridgeChannel.bridgeEnabled) ...   // 决定要不要显示网桥入口
```

**为什么不用 `--dart-define`**：那样要手动传参数，容易和 flavor 脱节。
从 BuildConfig 读，**单一事实来源**，改 flavor 就够。

### 快应用 package 切换

`scripts/vela-package.mjs` 直接改 `manifest.json` 的 `package` 字段，
用 2 空格缩进写回 —— 和原文件格式一致，切来切去 git diff 是干净的。

---

## 五、验证过的

```
app-band-debug.apk  package: com.nowmes.orhythm.band
app-std-debug.apk   package: com.nowmes.orhythm

两个签名指纹都是：
  e33dd67abc8c6ea9c3ce61bb7c550b41d7f9fc2fc4590e2d511547e14e13609e
（和手表端 apps/vela/sign/certificate.pem 一致）
```

`vela-package.mjs` 来回切过一遍，`manifest.json` 没有多余的 diff。

---

## 六、还没做的

1. **手表端的网桥开关还没恢复** —— 之前下线了，手环版要用就得加回来
2. **两个 RPK 还没实际打出来验证** —— 只切过 package，没跑 `aiot build`
3. **真机联调** —— 手机没插
4. **前台服务常驻** —— App 被杀掉手环就断网，现在只是文案提示
