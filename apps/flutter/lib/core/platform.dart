import 'dart:io' show Platform;

import 'package:flutter/foundation.dart';

/// 平台差异。
///
/// ── 为什么需要这一层 ────────────────────────────────────────────────
///
/// Flutter 的组件是**自绘**的 —— 一套 `Material` widget 在三个平台上
/// 长得一样。这是它的卖点，但也是它的陷阱：
///
///   · 配色：只有 Android 12+ 有动态取色（Material You），
///           iOS 和鸿蒙**没有**这个概念
///   · 导航：iOS 用户习惯「右滑返回」，Android 是返回键/手势条，
///           鸿蒙两边都像又都不完全像
///   · 弹窗：iOS 从底部弹出（bottom sheet），Android 是对话框
///   · 沉浸：鸿蒙和 Android 都支持状态栏透明，iOS 的刘海区处理又不一样
///
/// 所以策略是：**组件统一用 Material 3，行为按平台微调。**
///
/// 不做三套 UI —— 那是三倍工作量，而且用户装的是同一个 App，
/// 长得完全不同反而会让人以为下错了。
///
/// ── 动态色的能力矩阵 ────────────────────────────────────────────────
///
/// | 平台          | 动态取色 |
/// |---------------|---------|
/// | Android 12+   | ✅      |
/// | Android 11-   | ❌      |
/// | iOS           | ❌      |
/// | 鸿蒙          | ❌      |
///
/// 拿不到就用种子色（`#4FD6FF`）。**这条路必须能走，而且要好看。**
class AstraPlatform {
  const AstraPlatform._();

  /// 是不是 Android。
  static bool get isAndroid => !kIsWeb && Platform.isAndroid;

  /// 是不是 iOS。
  static bool get isIOS => !kIsWeb && Platform.isIOS;

  /// 是不是鸿蒙。
  ///
  /// ⚠️ **鸿蒙不是 `Platform.isOhos`。**
  ///
  /// OpenHarmony SIG 的 Flutter fork 让 `Platform.operatingSystem`
  /// 返回 `'ohos'`，但官方的 `Platform` 类**没有 `isOhos` 这个 getter** ——
  /// 只能比字符串。
  static bool get isHarmony => !kIsWeb && Platform.operatingSystem == 'ohos';

  /// 这个平台**理论上**支持动态取色。
  ///
  /// 只是"理论上" —— 实际还要看 API 级别和设备厂商。
  /// 真正的判断在原生侧（`MainActivity.dynamicColor()` 返回 null 就是没有）。
  ///
  /// 这个 getter 的用处是：**不支持就别去问**，省一次 MethodChannel 往返。
  static bool get maySupportDynamicColor => isAndroid;

  /// 用户习惯的页面切换方式。
  ///
  /// iOS 从右侧滑入（push），Android 从底部上浮（fade through）。
  /// 这个差别很小但很影响"像不像原生"。
  static TargetPlatform get materialPlatform {
    if (isIOS) return TargetPlatform.iOS;
    if (isHarmony) return TargetPlatform.android; // 鸿蒙跟 Android 更近
    return TargetPlatform.android;
  }

  /// 状态栏要不要透明。
  ///
  /// 三端都支持，但 iOS 上如果内容没留安全区，会顶到刘海里。
  /// 这个开关给页面用：为 true 时页面自己要加 `SafeArea`。
  static bool get usesEdgeToEdge => true;

  /// 一个人类可读的平台名，给"关于"页和诊断日志用。
  static String get label {
    if (kIsWeb) return 'Web';
    if (isHarmony) return 'HarmonyOS';
    if (isIOS) return 'iOS';
    if (isAndroid) return 'Android';
    return Platform.operatingSystem;
  }
}
