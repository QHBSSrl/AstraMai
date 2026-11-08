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
 * `dynamic_color` 的 1.x（`build.gradle.kts` 用了旧 Kotlin DSL）
 * 在 Flutter 3.35 + Kotlin 2.x 下编译不过；2.x 又要求
 * `material_color_utilities 0.13`，而 Flutter SDK 钉死在 0.11.1。
 *
 * 两边都不通，所以直接读系统色。
 *
 * ── ⚠️ 用语义色，不要用 tone 编号 ─────────────────────────────────
 *
 * 我第一版拼的是 `system_accent1_80` 这种 tone 名，结果全是 0。
 *
 * 因为 **Android 只暴露了部分 tone**：
 *
 *   system_accent1_0, _10, _50, _100, _200, _300, _400,
 *   _500, _600, _700, _800, _900, _1000
 *
 * 没有 _80 —— 而 MD3 深色主题的 primary 恰好就是 tone 80。拼错就静默返回 0。
 *
 * 正确的做法是用 **MD3 语义色**，Android 12 起全都在 framework-res 里：
 *
 *   system_primary_dark / system_on_primary_dark
 *   system_primary_container_dark / system_on_primary_container_dark
 *   system_secondary_* / system_tertiary_*
 *   system_surface_dark / system_surface_container_dark / ...
 *   system_outline_dark / system_outline_variant_dark
 *   system_error_dark / system_on_error_dark
 *
 * 这些名字和 Material 的 ColorScheme 是对应的，直接映射就完了，
 * 不用自己算 tone。
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
     *   · Android 11 及以下（API 31 才引入这套资源）
     *   · 设备厂商没实现（定制 ROM 可能缺）
     *
     * Dart 那边拿到 null 就用种子色，不报错。
     */
    private fun dynamicColor(): Map<String, Int>? {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return null

        return try {
            val isDark =
                (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
                    Configuration.UI_MODE_NIGHT_YES

            val palette = if (isDark) darkPalette() else lightPalette()

            // 一个都没读到就当作不支持 —— 宁可退回种子色，
            // 也不要用一堆 0（那是纯黑，用户会以为 App 坏了）
            if (palette.values.none { it != 0 }) null else palette
        } catch (error: Throwable) {
            null
        }
    }

    /** MD3 深色语义色。 */
    @RequiresApi(Build.VERSION_CODES.S)
    private fun darkPalette(): Map<String, Int> = mapOf(
        "primary" to color("system_primary_dark"),
        "onPrimary" to color("system_on_primary_dark"),
        "primaryContainer" to color("system_primary_container_dark"),
        "onPrimaryContainer" to color("system_on_primary_container_dark"),

        "secondary" to color("system_secondary_dark"),
        "onSecondary" to color("system_on_secondary_dark"),
        "secondaryContainer" to color("system_secondary_container_dark"),
        "onSecondaryContainer" to color("system_on_secondary_container_dark"),

        "tertiary" to color("system_tertiary_dark"),
        "onTertiary" to color("system_on_tertiary_dark"),
        "tertiaryContainer" to color("system_tertiary_container_dark"),
        "onTertiaryContainer" to color("system_on_tertiary_container_dark"),

        "surface" to color("system_surface_dark"),
        "onSurface" to color("system_on_surface_dark"),
        "surfaceVariant" to color("system_surface_variant_dark"),
        "onSurfaceVariant" to color("system_on_surface_variant_dark"),
        "surfaceContainerLowest" to color("system_surface_container_lowest_dark"),
        "surfaceContainerLow" to color("system_surface_container_low_dark"),
        "surfaceContainer" to color("system_surface_container_dark"),
        "surfaceContainerHigh" to color("system_surface_container_high_dark"),
        "surfaceContainerHighest" to color("system_surface_container_highest_dark"),

        "outline" to color("system_outline_dark"),
        "outlineVariant" to color("system_outline_variant_dark"),

        "error" to color("system_error_dark"),
        "onError" to color("system_on_error_dark"),

        "isDark" to 1,
    )

    /** MD3 浅色语义色。现在不用，但留着省得以后重写。 */
    @RequiresApi(Build.VERSION_CODES.S)
    private fun lightPalette(): Map<String, Int> = mapOf(
        "primary" to color("system_primary_light"),
        "onPrimary" to color("system_on_primary_light"),
        "primaryContainer" to color("system_primary_container_light"),
        "onPrimaryContainer" to color("system_on_primary_container_light"),

        "secondary" to color("system_secondary_light"),
        "onSecondary" to color("system_on_secondary_light"),
        "secondaryContainer" to color("system_secondary_container_light"),
        "onSecondaryContainer" to color("system_on_secondary_container_light"),

        "tertiary" to color("system_tertiary_light"),
        "onTertiary" to color("system_on_tertiary_light"),
        "tertiaryContainer" to color("system_tertiary_container_light"),
        "onTertiaryContainer" to color("system_on_tertiary_container_light"),

        "surface" to color("system_surface_light"),
        "onSurface" to color("system_on_surface_light"),
        "surfaceVariant" to color("system_surface_variant_light"),
        "onSurfaceVariant" to color("system_on_surface_variant_light"),
        "surfaceContainerLowest" to color("system_surface_container_lowest_light"),
        "surfaceContainerLow" to color("system_surface_container_low_light"),
        "surfaceContainer" to color("system_surface_container_light"),
        "surfaceContainerHigh" to color("system_surface_container_high_light"),
        "surfaceContainerHighest" to color("system_surface_container_highest_light"),

        "outline" to color("system_outline_light"),
        "outlineVariant" to color("system_outline_variant_light"),

        "error" to color("system_error_light"),
        "onError" to color("system_on_error_light"),

        "isDark" to 0,
    )

    /**
     * 按名字取 `android:color/` 里的颜色。
     *
     * 取不到返回 0 —— 调用方会把它当作"没有这个色"，
     * 再用 `ColorScheme.fromSeed` 补齐。
     */
    private fun color(name: String): Int {
        val id = resources.getIdentifier(name, "color", "android")
        if (id == 0) return 0

        @Suppress("DEPRECATION")
        return resources.getColor(id)
    }

    companion object {
        private const val CHANNEL = "astramai/dynamic_color"
    }
}
