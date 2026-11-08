import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'core/platform.dart';
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
      home: const _Placeholder(),
    );
  }
}

/// 临时占位页。
///
/// ⚠️ 这个是**临时的** —— 真正的首页是「个人名片 + 成绩卡片流」。
/// 现在放一个能跑的最小页面，是为了先验证：
///   1. 动态取色到底有没有生效（色块会跟着壁纸变）
///   2. MD3 组件在深色下是什么质感
///   3. 布局在这个尺寸下舒不舒服
class _Placeholder extends StatelessWidget {
  const _Placeholder();

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    // 动态色有没有生效 —— 这是这个页面最想验证的东西
    final dynamic = Theme.of(context).colorScheme.primary !=
        buildTheme().colorScheme.primary;

    return Scaffold(
      appBar: AppBar(title: const Text('AstraMai')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
        children: [
          _Section(
            title: '平台',
            child: Text(
              'AstraPlatform.label = ${AstraPlatform.label}\n'
              '支持动态取色 = ${AstraPlatform.maySupportDynamicColor}\n'
              '当前是否动态 = $dynamic',
              style: Theme.of(context).textTheme.bodyMedium,
            ),
          ),
          const SizedBox(height: 24),
          _Section(
            title: '主题色（Android 12+ 跟壁纸变）',
            child: Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                _Swatch('primary', scheme.primary, scheme.onPrimary),
                _Swatch('secondary', scheme.secondary, scheme.onSecondary),
                _Swatch('tertiary', scheme.tertiary, scheme.onTertiary),
                _Swatch(
                  'primaryContainer',
                  scheme.primaryContainer,
                  scheme.onPrimaryContainer,
                ),
                _Swatch('surface', scheme.surface, scheme.onSurface),
                _Swatch(
                  'surfaceContainer',
                  scheme.surfaceContainer,
                  scheme.onSurface,
                ),
              ],
            ),
          ),
          const SizedBox(height: 24),
          _Section(
            title: '评级色（固定，不跟主题变）',
            child: Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                _Swatch('SSS+', RateColors.of('sssp'), Colors.black),
                _Swatch('SS+', RateColors.of('ssp'), Colors.black),
                _Swatch('S+', RateColors.of('sp'), Colors.black),
                _Swatch('AAA', RateColors.of('aaa'), Colors.white),
                _Swatch('A', RateColors.of('a'), Colors.black),
              ],
            ),
          ),
          const SizedBox(height: 24),
          _Section(
            title: '难度色（固定）',
            child: Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (var i = 0; i < DifficultyColors.colors.length; i++)
                  _Swatch(
                    ['Basic', 'Adv', 'Exp', 'Mas', 'Re:M'][i],
                    DifficultyColors.of(i),
                    Colors.black,
                  ),
              ],
            ),
          ),
          const SizedBox(height: 24),
          _Section(
            title: 'MD3 组件',
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                FilledButton(
                  onPressed: () {},
                  child: const Text('FilledButton'),
                ),
                const SizedBox(height: 8),
                FilledButton.tonal(
                  onPressed: () {},
                  child: const Text('FilledButton.tonal'),
                ),
                const SizedBox(height: 16),
                Card(
                  child: ListTile(
                    leading: CircleAvatar(
                      backgroundColor: scheme.secondaryContainer,
                      child: Text(
                        'Q',
                        style: TextStyle(color: scheme.onSecondaryContainer),
                      ),
                    ),
                    title: const Text('QBHSSrl'),
                    subtitle: const Text('15,023 · 虹'),
                    trailing: FilledButton.tonal(
                      onPressed: () {},
                      child: const Text('查询'),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: 0,
        onDestinationSelected: (_) {},
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.leaderboard_outlined),
            selectedIcon: Icon(Icons.leaderboard),
            label: '首页',
          ),
          NavigationDestination(
            icon: Icon(Icons.search_outlined),
            selectedIcon: Icon(Icons.search),
            label: '搜索',
          ),
          NavigationDestination(
            icon: Icon(Icons.person_outline),
            selectedIcon: Icon(Icons.person),
            label: '我的',
          ),
        ],
      ),
    );
  }
}

class _Section extends StatelessWidget {
  const _Section({required this.title, required this.child});

  final String title;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          title,
          style: Theme.of(context).textTheme.titleSmall?.copyWith(
                color: Theme.of(context).colorScheme.onSurfaceVariant,
              ),
        ),
        const SizedBox(height: 12),
        child,
      ],
    );
  }
}

class _Swatch extends StatelessWidget {
  const _Swatch(this.label, this.color, this.onColor);

  final String label;
  final Color color;
  final Color onColor;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 104,
      height: 52,
      decoration: BoxDecoration(
        color: color,
        borderRadius: BorderRadius.circular(10),
      ),
      alignment: Alignment.center,
      padding: const EdgeInsets.symmetric(horizontal: 4),
      child: Text(
        label,
        textAlign: TextAlign.center,
        maxLines: 2,
        overflow: TextOverflow.ellipsis,
        style: TextStyle(
          color: onColor,
          fontSize: 10,
          fontWeight: FontWeight.w600,
          height: 1.2,
        ),
      ),
    );
  }
}
