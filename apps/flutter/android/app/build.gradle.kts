import java.util.Properties

plugins {
    id("com.android.application")
    id("kotlin-android")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

/*
 * 签名配置。
 *
 * ⚠️ **必须用 apps/vela/sign 那套证书，不能用 debug keystore。**
 *
 * 小米穿戴的 interconnect 会校验「手表快应用」和「手机 App」是不是
 * 同一个证书签的。不一致就直接拒绝连接，而且不报有用的错。
 *
 * 所以 debug 包也用这个签名 —— 不然调试阶段完全测不了通信。
 *
 * 密码在 key.properties（不进 git）。
 */
val keystoreProperties = Properties().apply {
    val f = rootProject.file("key.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}

android {
    namespace = "com.astranexus.astramai"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }

    kotlinOptions {
        jvmTarget = JavaVersion.VERSION_11.toString()
    }

    defaultConfig {
        /*
         * applicationId = 用户在桌面 / 系统里看到的包身份。现在归 NowMes Software。
         *
         * ⚠️ **`namespace` 保持 `com.astranexus.astramai` 不动。**
         *
         * namespace 是 R 类包名、也是 `android:name=".MainActivity"` 相对解析
         * 的基准，它和 Kotlin 源目录绑定 —— 改它就要搬整个
         * `app/src/main/kotlin/com/astranexus/astramai/` 目录。
         *
         * applicationId 和 namespace 分离是 Android 的标准做法，两者不同
         * 完全没问题。
         */
        applicationId = "com.nowmes.orhythm"
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    /*
     * 只有一个包体。
     *
     * ── 为什么不用分包了 ────────────────────────────────────────────
     *
     * 手环 Pro 没有 `@system.fetch`，需要手机中转；手表自带联网能力，
     * 用不上网桥。
     *
     * 一开始判断不了设备类型（手机端只能看到用户自定义的 `Node.name`），
     * 所以分成 std / band 两个包体，「装哪个就是哪类设备」。
     *
     * **现在不需要了** —— `device.getInfo()` 直接返回 `deviceType`
     * （`watch` / `band` / `smartspeaker`，APILevel 2+）。
     * 手表自己就知道该显示什么，不用在包体上区分。
     *
     * 分包还有个实打实的坏处：**包名一变就是新 App**，
     * 用户数据清零、要重装、包名还得和快应用逐字对齐。
     * 能不分就不分。
     *
     * ⚠️ **applicationId 必须和快应用的 package 一致**，否则 interconnect
     * 连不上。快应用那边是 `apps/vela/src/manifest.json` 的 `package`。
     */
    buildFeatures {
        buildConfig = true
    }

    signingConfigs {
        if (keystoreProperties.isEmpty) {
            logger.warn(
                "[AstraMai] ⚠️ 找不到 key.properties，回退到 debug 签名。" +
                    "interconnect 通信会因为证书不一致而失败。"
            )
        } else {
            create("astramai") {
                storeFile = file(keystoreProperties["storeFile"] as String)
                storePassword = keystoreProperties["storePassword"] as String
                keyAlias = keystoreProperties["keyAlias"] as String
                keyPassword = keystoreProperties["keyPassword"] as String
                // 证书是从手表端的 PEM 转出来的，类型是 PKCS12
                storeType = keystoreProperties["storeType"] as String
            }
        }
    }

    buildTypes {
        /*
         * release 和 debug 都用同一个签名。
         *
         * ⚠️ 这一点对 interconnect 是硬要求 —— 我装了 debug 包去测，
         * 如果 debug 用 debug keystore 签名，手表那边会静默拒绝连接，
         * 而且现象是「握手超时」这种完全看不出原因的样子。
         */
        val sign = if (keystoreProperties.isEmpty) {
            signingConfigs.getByName("debug")
        } else {
            signingConfigs.getByName("astramai")
        }

        debug {
            signingConfig = sign
        }
        release {
            signingConfig = sign
        }
    }
}

/*
 * 小米穿戴 SDK。
 *
 * 它**没有 Maven 依赖**，只能手动放 AAR —— 官方只提供 zip 下载，
 * 不在任何公开仓库里。
 *
 * 提供的能力：
 *   Wearable.getNodeApi(ctx).getConnectedNodes()
 *   Wearable.getAuthApi(ctx).checkPermission(nodeId, Permission.DEVICE_MANAGER)
 *   Wearable.getMessageApi(ctx).sendMessage(nodeId, byte[])
 *   Wearable.getMessageApi(ctx).addListener(nodeId, OnMessageReceivedListener)
 *
 * 消息是 **byte[]**，我们约定为 UTF-8 JSON —— 和手表端
 * `connect.send({data: {...}})` 的序列化结果一致。
 */
dependencies {
    implementation(files("libs/xms-wearable-lib-1.4.aar"))
}

flutter {
    source = "../.."
}
