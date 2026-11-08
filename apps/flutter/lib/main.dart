import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'core/platform.dart';
import 'ui/material/main_shell.dart';
import 'ui/theme.dart';

/// 应用入口。
///
/// ── 动态取色（Material You）────────────────────────────────────────
///
/// Android 12+ 可以从**壁纸**推导整套色板，让 App 跟着系统主题变。
/// 这是 MD3 的核心体验之一 —— 用户选了 MD3 就是想要这个。
///
/// 但它只有 Android 有：
///   · Android 12+  → 有
///   · Android 11-  → 没有
///   · iOS          → 没有
///   · 鸿蒙         → 没有
///
/// 所以是「有就用，没有就退回种子色」。
///
/// ⚠️ **失败必须能退回。** 拿不到动态色还硬用会变成一片纯色，
/// 用户只会觉得 App 坏了。
void main() {
  runApp(const AstraMaiApp());
}

class AstraMaiApp extends StatefulWidget {
  const AstraMaiApp({super.key});

  @override
  State<AstraMaiApp> createState() => _AstraMaiAppState();
}

class _AstraMaiAppState extends State<AstraMaiApp> {
  /// 从系统拿到的色板。null 表示这台设备不支持，用种子色。
  ColorScheme? _dynamicScheme;

  static const MethodChannel _channel = MethodChannel('astramai/dynamic_color');

  @override
  void initState() {
    super.initState();
    _loadDynamicColor();
  }

  Future<void> _loadDynamicColor() async {
    /*
     * ⚠️ **先判断平台，别白问一次。**
     *
     * 动态取色只有 Android 12+ 有。iOS 和鸿蒙**没有这个概念** ——
     * 在那边调这个方法只会得到 MissingPluginException，
     * 白白多一次异步往返。
     *
     * 所以先问 AstraPlatform：不支持就根本不建这个 channel 调用，
     * 直接用种子色。
     */
    if (!AstraPlatform.maySupportDynamicColor) return;

    try {
      final result = await _channel.invokeMethod<Map<Object?, Object?>>(
        'dynamicColor',
      );
      // ignore: avoid_print
      print('[AstraMai] dynamicColor 原值: $result');

      if (result == null) {
        // ignore: avoid_print
        print('[AstraMai] 原生返回 null —— 这台设备没有动态色');
        return;
      }
      if (!mounted) return;

      final scheme = _schemeFromPlatform(result);
      // ignore: avoid_print
      print('[AstraMai] 转换后的 primary: ${scheme?.primary}');

      if (scheme != null) setState(() => _dynamicScheme = scheme);
    } on PlatformException catch (e) {
      // ignore: avoid_print
      print('[AstraMai] PlatformException: ${e.code} ${e.message}');
    } on MissingPluginException catch (e) {
      // ignore: avoid_print
      print('[AstraMai] MissingPluginException: ${e.message}');
    }
  }

  /// 把原生给的色值转成 [ColorScheme]。
  ///
  /// ── 为什么不再用 fromSeed ────────────────────────────────────────
  ///
  /// 第一版是「拿系统主色当种子，再覆盖 12 个色」。
  /// 那样虽然色板协调，但**不是系统的真实配色** —— surface / outline
  /// 这些还是我们算的，和系统设置里的深浅、对比度都对不上。
  ///
  /// 现在原生直接给了 MD3 的语义色（system_primary_dark /
  /// system_surface_container_dark 这些），一一对应就能填满。
  ///
  /// 缺哪个就用 fromSeed 的对应值兜底 —— 定制 ROM 可能少几个。
  ColorScheme? _schemeFromPlatform(Map<Object?, Object?> raw) {
    // 原生用 0 表示"没取到"
    Color? read(String key) {
      final value = raw[key];
      if (value is! int || value == 0) return null;
      return Color(0xFF000000 | value);
    }

    if (read('primary') == null) return null;

    final isDark = (raw['isDark'] as int? ?? 1) == 1;
    final brightness = isDark ? Brightness.dark : Brightness.light;

    // 兜底色板：拿系统的 primary 当种子，
    // 这样就算缺几个色，补出来的也是同一个色调
    final fallback = ColorScheme.fromSeed(
      seedColor: read('primary')!,
      brightness: brightness,
    );

    Color pick(String key, Color fallbackColor) => read(key) ?? fallbackColor;

    return ColorScheme(
      brightness: brightness,
      primary: pick('primary', fallback.primary),
      onPrimary: pick('onPrimary', fallback.onPrimary),
      primaryContainer: pick('primaryContainer', fallback.primaryContainer),
      onPrimaryContainer:
          pick('onPrimaryContainer', fallback.onPrimaryContainer),
      secondary: pick('secondary', fallback.secondary),
      onSecondary: pick('onSecondary', fallback.onSecondary),
      secondaryContainer:
          pick('secondaryContainer', fallback.secondaryContainer),
      onSecondaryContainer:
          pick('onSecondaryContainer', fallback.onSecondaryContainer),
      tertiary: pick('tertiary', fallback.tertiary),
      onTertiary: pick('onTertiary', fallback.onTertiary),
      tertiaryContainer: pick('tertiaryContainer', fallback.tertiaryContainer),
      onTertiaryContainer:
          pick('onTertiaryContainer', fallback.onTertiaryContainer),
      error: pick('error', fallback.error),
      onError: pick('onError', fallback.onError),
      surface: pick('surface', fallback.surface),
      onSurface: pick('onSurface', fallback.onSurface),
      surfaceContainerLowest:
          pick('surfaceContainerLowest', fallback.surfaceContainerLowest),
      surfaceContainerLow:
          pick('surfaceContainerLow', fallback.surfaceContainerLow),
      surfaceContainer: pick('surfaceContainer', fallback.surfaceContainer),
      surfaceContainerHigh:
          pick('surfaceContainerHigh', fallback.surfaceContainerHigh),
      surfaceContainerHighest:
          pick('surfaceContainerHighest', fallback.surfaceContainerHighest),
      outline: pick('outline', fallback.outline),
      outlineVariant: pick('outlineVariant', fallback.outlineVariant),
    );
  }
  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'AstraMai',
      debugShowCheckedModeBanner: false,
      theme: buildTheme(
        dynamicScheme: _dynamicScheme,
        brightness: MediaQuery.platformBrightnessOf(context),
      ),
      home: const MainShell(),
    );
  }
}
