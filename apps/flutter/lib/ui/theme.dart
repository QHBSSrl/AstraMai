import 'package:flutter/material.dart';

/// Material 3 主题。
///
/// ── 用 `ColorScheme.fromSeed` 而不是手写颜色表 ──────────────────────
///
/// MD3 的整套色板（primary / on-primary / surface-container / outline …）
/// 是**从一颗种子色推导**出来的，有几十个角色。手写一遍既容易漏，
/// 又会和组件库对不上（比如 `Card` 用的是 `surfaceContainerLow`，
/// 你手写的 `#101827` 根本不会被用到）。
///
/// 所以这里只给种子色，剩下的交给 `fromSeed`。
///
/// ── 动态取色（Material You）────────────────────────────────────────
///
/// Android 12+ 可以从**壁纸**取色，让 App 跟着系统主题变。
/// 这是 MD3 最核心的体验之一，用户选了这个就是不想要一套写死的配色。
///
/// 但它**只有 Android 有**：
///   · iOS —— 没有这个概念，用我们的种子色
///   · 鸿蒙 —— 同样没有
///   · Android 11 及以下 —— 不支持，用种子色
///
/// 所以做法是：**动态色可用就用，不可用就退回种子色**。
/// 两条路的组件结构完全一样，只是色板不同。
///
/// ── 种子色为什么是青色 ──────────────────────────────────────────────
///
/// 和手表端、官网的主色一致（`#4fd6ff`）。用户的视觉记忆是连着的，
/// 从手表换到手机不该像换了个 App。

/// 种子色。和手表端、官网的主色一致。
const Color seedColor = Color(0xFF4FD6FF);

/// 造深色主题。
///
/// [dynamicScheme] 传 `DynamicSchemeVariant.tonalSpot` 之类是给
/// `dynamic_color` 包用的；这里只接收一个已经算好的 [ColorScheme]，
/// 让调用方决定从哪来（壁纸 / 种子）。
ThemeData buildTheme({ColorScheme? dynamicScheme, Brightness? brightness}) {
  /*
   * ── 兜底色板要跟随系统，不能写死深色 ──────────────────────────────
   *
   * 原来的兜底是 Brightness.dark —— 但 Android 12+ 拿到动态色之后，
   * 原生返回的 isDark 是**系统当前是不是深色模式**。
   *
   * 如果系统是浅色，动态色是浅色的，而兜底还写死深色 ——
   * 两套主题切换时就会闪一下，而且 iOS / 鸿蒙上的视觉和 Android 不一致。
   *
   * 所以兜底也跟随系统。MD3 本来就该这样。
   */
  final scheme = dynamicScheme ??
      ColorScheme.fromSeed(
        seedColor: seedColor,
        brightness: brightness ?? Brightness.dark,
      );

  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    // 深色主题下纯黑更好看，MD3 的 surface 有点发灰
    scaffoldBackgroundColor: scheme.surface,

    appBarTheme: AppBarTheme(
      backgroundColor: scheme.surface,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      scrolledUnderElevation: 0,
      centerTitle: false,
    ),

    cardTheme: CardThemeData(
      // 用 MD3 的「低层容器」而不是纯色 —— 卡片和背景才有层次
      color: scheme.surfaceContainerLow,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
    ),

    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: scheme.surfaceContainer,
      indicatorColor: scheme.secondaryContainer,
      elevation: 0,
      height: 68,
      labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
    ),

    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(999)),
        padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 14),
      ),
    ),

    chipTheme: ChipThemeData(
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
      side: BorderSide.none,
    ),

    dividerTheme: DividerThemeData(
      color: scheme.outlineVariant.withValues(alpha: 0.5),
      thickness: 1,
      space: 1,
    ),
  );
}

/// 评级颜色。
///
/// ⚠️ **这个不能用动态色。**
///
/// 评级（SSS+ / SS / A …）在音游里有**固定的语义颜色**，玩家一眼就认。
/// 跟着壁纸变色的话，金色 SSS 变成绿色会让人以为算错了。
///
/// 所以这部分**永远写死**，和主题无关。
class RateColors {
  const RateColors._();

  static const Color gold = Color(0xFFFFD700); // SSS+ / SSS
  static const Color orange = Color(0xFFFF9F43); // SS+ / SS
  static const Color cyan = Color(0xFF4FD6FF); // S+ / S
  static const Color purple = Color(0xFFA855F7); // AAA / AA
  static const Color green = Color(0xFF3DDC84); // A
  static const Color grey = Color(0xFF9BACD0); // 其余

  /// 按落雪的 `rate` 字段取色。
  ///
  /// 同一颜色覆盖两档 —— 再细分玩家认不出来，反而要每次都查表。
  static Color of(String rate) {
    switch (rate.toLowerCase()) {
      case 'sssp':
      case 'sss':
        return gold;
      case 'ssp':
      case 'ss':
        return orange;
      case 'sp':
      case 's':
        return cyan;
      case 'aaa':
      case 'aa':
        return purple;
      case 'a':
        return green;
      default:
        return grey;
    }
  }
}

/// 难度颜色。
///
/// 同样的理由：游戏内的难度色是固定的（绿/黄/红/紫/白），
/// 跟着壁纸变会让玩家认不出谱面难度。
class DifficultyColors {
  const DifficultyColors._();

  static const List<Color> colors = [
    Color(0xFF22C55E), // Basic    绿
    Color(0xFFF59E0B), // Advanced 黄
    Color(0xFFEF4444), // Expert   红
    Color(0xFFA855F7), // Master   紫
    Color(0xFFE5E7EB), // Re:Master 白
  ];

  /// ⚠️ Re:Master 是白色，浅色主题下需要给色块加边框才看得见。
  /// 界面代码里记得 Border.all(color: Theme.of(context).colorScheme.outlineVariant)。
  static Color of(int levelIndex) =>
      levelIndex >= 0 && levelIndex < colors.length
          ? colors[levelIndex]
          : const Color(0xFF94A3B8);
}
