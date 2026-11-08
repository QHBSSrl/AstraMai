import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

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
    try {
      final result = await _channel.invokeMethod<Map<Object?, Object?>>(
        'dynamicColor',
      );
      if (result == null || !mounted) return;

      final scheme = _schemeFromPlatform(result);
      if (scheme != null) setState(() => _dynamicScheme = scheme);
    } on PlatformException {
      // iOS / 鸿蒙没有这个 channel —— 正常情况，用种子色
    } on MissingPluginException {
      // 同上
    }
  }

  /// 把原生给的色值转成 [ColorScheme]。
  ///
  /// 原生只给了 12 个关键色，其余的（surface / outline / …）由
  /// [ColorScheme.fromSeed] 用 primary 当种子补齐 —— 这样整个色板是**协调**的，
  /// 而不是 12 个颜色硬凑在一起。
  ColorScheme? _schemeFromPlatform(Map<Object?, Object?> raw) {
    int? read(String key) {
      final value = raw[key];
      if (value is! int || value == 0) return null;
      return value;
    }

    final primary = read('primary');
    if (primary == null) return null;

    final seed = Color(0xFF000000 | primary);

    // 用系统主色当种子推导整套深色色板，再覆盖掉系统**明确给了**的几个
    final base = ColorScheme.fromSeed(
      seedColor: seed,
      brightness: Brightness.dark,
    );

    Color withAlpha(int? argb, Color fallback) =>
        argb == null ? fallback : Color(0xFF000000 | argb);

    return base.copyWith(
      primary: withAlpha(read('primary'), base.primary),
      onPrimary: withAlpha(read('onPrimary'), base.onPrimary),
      secondary: withAlpha(read('secondary'), base.secondary),
      onSecondary: withAlpha(read('onSecondary'), base.onSecondary),
      tertiary: withAlpha(read('tertiary'), base.tertiary),
      onTertiary: withAlpha(read('onTertiary'), base.onTertiary),
      primaryContainer: withAlpha(read('primaryContainer'), base.primaryContainer),
      onPrimaryContainer:
          withAlpha(read('onPrimaryContainer'), base.onPrimaryContainer),
      secondaryContainer:
          withAlpha(read('secondaryContainer'), base.secondaryContainer),
      onSecondaryContainer:
          withAlpha(read('onSecondaryContainer'), base.onSecondaryContainer),
      tertiaryContainer:
          withAlpha(read('tertiaryContainer'), base.tertiaryContainer),
      onTertiaryContainer:
          withAlpha(read('onTertiaryContainer'), base.onTertiaryContainer),
    );
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'AstraMai',
      debugShowCheckedModeBanner: false,
      theme: buildTheme(dynamicScheme: _dynamicScheme),
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

    return Scaffold(
      appBar: AppBar(title: const Text('AstraMai')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
        children: [
          _Section(
            title: '主题色（跟着壁纸变）',
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
