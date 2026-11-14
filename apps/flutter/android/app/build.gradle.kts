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

flutter {
    source = "../.."
}
