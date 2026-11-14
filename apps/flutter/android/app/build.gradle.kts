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
        applicationId = "com.astranexus.astramai"
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    /*
     * 两个包体。
     *
     * ┌──────────┬─────────────────────────────────┬──────────────────────┐
     * │ flavor   │ applicationId                   │ 用途                  │
     * ├──────────┼─────────────────────────────────┼──────────────────────┤
     * │ std      │ com.astranexus.astramai         │ 手表（Watch 系列）     │
     * │ band     │ com.astranexus.astramai.band    │ 手环 Pro（带网桥）     │
     * └──────────┴─────────────────────────────────┴──────────────────────┘
     *
     * ── 为什么要分两个包 ────────────────────────────────────────────
     *
     * 手环 Pro 没有 `@system.fetch`，必须靠手机中转；手表自带联网能力，
     * 完全用不上网桥。
     *
     * 运行时判断设备型号不可靠（`Node.name` 是用户自定义的设备名），
     * 猜错了会让 Pro 用户根本看不见入口。所以干脆分成两个包体，
     * 各自上传、各自安装 —— **装哪个就是哪类设备**，不用猜。
     *
     * ⚠️ **applicationId 必须和对应快应用的 package 一致**，
     * 否则 interconnect 连不上。所以打包时：
     *
     *   手表版：flutter build apk --flavor std
     *           快应用 package = com.astranexus.astramai
     *
     *   手环版：flutter build apk --flavor band
     *           快应用 package = com.astranexus.astramai.band
     *
     * 快应用的 package 用 `npm run package:band` 切换（见 apps/vela）。
     */
    flavorDimensions += "device"

    productFlavors {
        create("std") {
            dimension = "device"
            // 不加密后缀，applicationId 保持 com.astranexus.astramai
            buildConfigField("boolean", "BRIDGE_ENABLED", "false")
        }
        create("band") {
            dimension = "device"
            applicationIdSuffix = ".band"
            // 给 Dart 侧一个编译期开关，用来决定要不要显示网桥入口
            buildConfigField("boolean", "BRIDGE_ENABLED", "true")
        }
    }

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
