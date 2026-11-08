package com.astranexus.astramai

import android.content.res.Configuration
import android.os.Build
import androidx.annotation.RequiresApi
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

/**
 * 主 Activity。
 *
 * ── 为什么自己取动态色，不用 `dynamic_color` 包 ────────────────────
 *
 * `dynamic_color` 的 1.x 版本（`build.gradle.kts` 里用了旧 Kotlin DSL）
 * 在 Flutter 3.35 + Kotlin 2.x 下编译不过；
 * 2.x 又要求 `material_color_utilities 0.13`，而 Flutter SDK 把它钉死在 0.11.1。
 *
 * 两边都不通，所以直接读系统色 —— Android 12（API 31）起有
 * `android.R.color.system_accent1_*` 这一组，就是从壁纸生成的。
 *
 * 代码量比折腾依赖少，而且**行为可控**：拿不到就返回 null，
 * Dart 那边退回种子色。
 */
class MainActivity : FlutterActivity() {

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)

        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, CHANNEL)
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "dynamicColor" -> result.success(dynamicColor())
                    else -> result.notImplemented()
                }
            }
    }

    /**
     * 取系统动态色。
     *
     * 返回 null 的情况：
     *   · Android 11 及以下（没有动态色）
     *   · 设备厂商没实现（某些定制 ROM 会缺这些资源）
     *
     * Dart 那边拿到 null 就用种子色，不报错。
     */
    private fun dynamicColor(): Map<String, Int>? {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return null

        return try {
            val isDark =
                (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
                    Configuration.UI_MODE_NIGHT_YES

            // 系统给的不是 MD3 的角色名，是 4 组「色调」：
            //   accent1 = 主色系（primary / secondary 都从它派生）
            //   accent2 = 次色系
            //   accent3 = 强调色系
            //   neutral1 = 中性色（surface / on-surface）
            // 每组有 0..1000 十档亮度 + 10 个固定档。
            accentPalette(isDark)
        } catch (error: Throwable) {
            // 资源缺失（定制 ROM）—— 退回种子色
            null
        }
    }

    @RequiresApi(Build.VERSION_CODES.S)
    private fun accentPalette(isDark: Boolean): Map<String, Int> {
        // 深色用 80（亮），浅色用 40（深）—— 和 MD3 的 tonal palette 规则一致
        val tone = if (isDark) 80 else 40
        val containerTone = if (isDark) 30 else 90

        fun pick(group: Int, t: Int): Int {
            val name = "system_accent$group" + "_" + t
            val id = resources.getIdentifier(name, "color", "android")
            return if (id != 0) {
                @Suppress("DEPRECATION")
                resources.getColor(id)
            } else {
                0
            }
        }

        return mapOf(
            "primary" to pick(1, tone),
            "secondary" to pick(2, tone),
            "tertiary" to pick(3, tone),
            "primaryContainer" to pick(1, containerTone),
            "secondaryContainer" to pick(2, containerTone),
            "tertiaryContainer" to pick(3, containerTone),
            "onPrimary" to pick(1, if (isDark) 20 else 100),
            "onSecondary" to pick(2, if (isDark) 20 else 100),
            "onTertiary" to pick(3, if (isDark) 20 else 100),
            "onPrimaryContainer" to pick(1, if (isDark) 90 else 10),
            "onSecondaryContainer" to pick(2, if (isDark) 90 else 10),
            "onTertiaryContainer" to pick(3, if (isDark) 90 else 10),
            "isDark" to if (isDark) 1 else 0,
        )
    }

    companion object {
        private const val CHANNEL = "astramai/dynamic_color"
    }
}
