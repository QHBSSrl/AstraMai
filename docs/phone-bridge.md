# 手机 App ↔ 手表 互联（interconnect 桥接）

> 目标：小米手环 Pro / 手表**没有 `@system.fetch`**，让手机 App 当它的网络出口。

---

## 一、官方机制的三个硬前提

来自 [interconnect 官方文档](https://iot.mi.com/vela/quickapp/zh/features/network/interconnect.html)：

| # | 要求 | 我们现在的状态 |
|---|---|---|
| 1 | 快应用 `manifest.json` 的 `package` = 手机 App 的包名 | ✅ 两边都是 `com.astranexus.astramai` |
| 2 | 快应用要用**和手机 App 相同的证书**签名 | ✅ 已完成（见下） |
| 3 | 手机端要集成 **XMS Wearable SDK** | ❌ **缺 SDK** |

**第 1、2 条是静默失败的重灾区** —— 不满足时连接直接被拒，
现象往往是「握手超时」，完全看不出真正原因。

---

## 二、已完成：签名统一

### 之前的问题

```
手表 RPK  → apps/vela/sign/{private,certificate}.pem
            C=CN, O=AstraNexus Tech, CN=Ruilin Song
            SHA-256 E3:3D:D6:7A:BC:8C:6E:A9:...

手机 APK  → Android debug keystore
            C=US, O=Android, CN=Android Debug
            SHA-256 674ae27ba51f5afefd81...

→ 指纹不同，interconnect 会拒绝连接
```

### 现在

从手表端那套 PEM 转了一个 PKCS12 keystore 给 Android 用：

```bash
openssl pkcs12 -export \
  -in  apps/vela/sign/certificate.pem \
  -inkey apps/vela/sign/private.pem \
  -name astramai \
  -out apps/flutter/android/app/astramai-release.p12 \
  -passout pass:<见 key.properties>
```

`build.gradle.kts` 里 **debug 和 release 都用这个签名** ——
调试阶段如果用 debug keystore，装上去也是连不通。

**验证过：**

```
apksigner verify --print-certs app-debug.apk
→ e33dd67abc8c6ea9c3ce61bb7c550b41d7f9fc2fc4590e2d511547e14e13609e
手表证书 E3:3D:D6:7A:BC:8C:6E:A9:...E1:4E:13:60:9E
→ 一致 ✅
```

**密码在 `apps/flutter/android/key.properties`，不进 git。**
`.gitignore` 已排除 `key.properties` / `*.p12` / `*.jks` / `*.keystore`。

⚠️ **还有一件事没做**：手表那边的 `.rpk` 现在的签名证书就是这个，
所以不用改。但**如果以后换证书，两边必须一起换**。

---

## 三、还缺：XMS Wearable SDK

手机端要收 `interconnect` 的消息，必须在 Android 工程里集成小米的穿戴 SDK。

我知道的 API 形状（来自官方接口文档）：

```java
// 1. 拿已连接设备
NodeApi nodeApi = Wearable.getNodeApi(context);
nodeApi.getConnectedNodes().addOnSuccessListener(nodes -> { ... });

// 2. 权限（第一次调用会自动授予 DEVICE_MANAGER / Notify）
AuthApi authApi = Wearable.getAuthApi(context);
authApi.checkPermission(nodeId, Permission.DEVICE_MANAGER);

// 3. 收发消息
MessageApi messageApi = Wearable.getMessageApi(context);
messageApi.sendMessage(nodeId, payload, callback);
messageApi.addListener(listener);   // onMessageReceived(nodeId, data)
```

**但这些类名我没法从公开渠道确认到包路径和签名**，而这个 SDK
没有 Maven 依赖，只能手动放 `.aar`/`.jar`。

### 需要你拿到的东西

二选一：

1. **`XMS Wearable Demo.zip`** 里的 `libs/`（官方 demo 自带的依赖库）
   —— 在 <https://gitcode.com/open-vela/packages_apps/tree/dev/wearable/interconnect_image_demo>
   的 `android_program/` 目录下
   （我试过匿名下载，GitCode 返回的是登录页，拿不到）

2. **小米穿戴第三方 APP 能力开放接口文档** 里给的 SDK 下载入口
   <https://vela-docs.cnbj1.mi-fds.com/vela-docs/files/小米穿戴第三方APP能力开放接口文档_1.4.pdf>

拿到之后放到 `apps/flutter/android/app/libs/`，我就能接上。

---

## 四、协议（我们自己的，跑在 interconnect 之上）

interconnect 本身只是个**消息通道**（发 Object，收 String，单帧约 64KB）。
真正的 HTTP 代理协议是我们自己定的，规范在
[plugins/fetchbridge/PROTOCOL.md](../../plugins/fetchbridge/PROTOCOL.md)（52 KB，官方 FetchBridge 的完整规范）。

手表端实现已经有了：`apps/vela/src/common/fetchbridge.js`。

**手机端要实现的是这个协议的服务端那一半：**

```
手表                                   手机
 │  {tag:'__hs__', count:0, caps}  →    │  握手
 │  ← {tag:'__hs__', count:1, caps}     │
 │  {tag:'__hs__', count:2, ...}   →    │  握手完成
 │                                      │
 │  {tag:'fetch', id, url, options} →   │  请求
 │                                      │  → 真正发 HTTP
 │  ← {tag:'fetch', id, resp:{...}}     │  响应头
 │  ← {tag:'fetch-stream', id, seq,     │  数据分片
 │      offset, data, crc32}            │
 │  {tag:'fetch-stream-ack', id, ack}→  │  ACK（v4）
```

关键约束：

| | |
|---|---|
| **单帧上限** | 约 64 KB（interconnect 的） |
| **CRC32** | 每帧校验，**失败不能推进 ACK** |
| **ACK 语义** | `ack` = 「下一个还缺的序号」 |
| **v4 不允许无 ACK 流式发送** | |

我们已经做到了 **88.6 KB 的 B50 压到 11.8 KB**（服务端 `/api/v1/maimai/b50/compact`），
就是为了塞进单帧上限。

---

## 五、实施顺序

| 步 | 做什么 | 状态 |
|---|---|---|
| 1 | 包名一致 | ✅ 早就一致 |
| 2 | 签名一致 | ✅ 本次完成 |
| 3 | 拿到 XMS Wearable SDK | ❌ 等你 |
| 4 | Android 集成 SDK，打通 `onmessage` / `send` | 待做 |
| 5 | 用 Kotlin 实现协议的服务端那一半 | 待做 |
| 6 | 手表端把网桥重新打开（之前下线了） | 待做 |
| 7 | 真机联调 | 待做 |

---

## 六、第 4、5 步的架构设想

```
lib/  ── MethodChannel ──▶  android/
                              BridgeService        启动/停止
                                ├─ InterconnectTransport   接口
                                │    └─ XmsWearableTransport  ← 需要 SDK
                                └─ BridgeProtocol           帧编解码 + CRC32
                                     └─ BridgeServer        HTTP 代理逻辑
```

**把协议和 SDK 隔开**，这样：
- 协议部分（占 80% 工作量）现在就能写、能单元测试
- SDK 到手后只补一个薄薄的 adapter

---

## 七、一个必须提前想的问题

**手机 App 被杀掉，手表就断网了。**

小米穿戴的通信要求手机 App 在前台或活着。要做成「随时可用」，
需要：

- **前台服务**（ongoing notification）保持进程
- 或者用 **XMS SDK 的 dex 常驻能力**（如果有）
- 用户要能感知状态：手表那边连不上时，设置页要明确说
  「请保持手机上 AstraMai 在运行」

**这个体验是硬伤，得在产品上说清楚。**
