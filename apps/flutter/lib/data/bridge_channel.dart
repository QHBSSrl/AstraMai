import 'package:flutter/services.dart';

/// 手机↔手表 网桥的控制通道。
///
/// ── 为什么只有几个方法 ──────────────────────────────────────────────
///
/// 真正的收发全在 Kotlin 里跑（`WearableBridge`）。Dart 这边只负责
/// 开关和展示状态 —— **每一条消息都过一次 MethodChannel 会白白多一层延迟**，
/// 而手环那边对延迟敏感。
///
/// 所以：
///   · Dart  → 启动 / 停止 / 查状态 / 查功能开关
///   · Kotlin→ 收到帧直接在原生侧发 HTTP，不回到 Dart
class BridgeChannel {
  BridgeChannel({MethodChannel? channel})
      : _channel = channel ?? const MethodChannel('astramai/bridge') {
    _channel.setMethodCallHandler(_onNativeCall);
  }

  final MethodChannel _channel;

  /// 原生侧主动推状态变更时回调。
  void Function(BridgeStatus status)? onStatusChanged;

  /// 网桥入口要不要显示。
  ///
  /// **现在是恒 true。** 曾经按 Gradle flavor（std / band 两个包体）区分，
  /// 但那套已经去掉了：
  ///
  ///   · 手机端看不到手表的 `deviceType`，猜错的代价是 Pro 用户
  ///     找不到唯一能联网的开关
  ///   · 手环那一侧自己会按 `deviceType` 决定显不显示「网络」区块
  ///   · 手机这页的文案已经写明「仅手环 Pro 系列需要」
  ///
  /// 所以手机上一直显示，反而更稳。
  static bool get bridgeEnabled => true;

  /// 当前 applicationId（诊断用）。
  static String applicationId = '';

  /// App 版本，从 BuildConfig 读（和 pubspec 保持一致）。
  static String versionName = '';

  /// 官网地址。下载、公告、更新日志都在这里。
  static const String website = 'https://orhythm.astranexus.cn';

  /// 读一次编译期开关。App 启动时调一次即可。
  static Future<void> loadFeatures({MethodChannel? channel}) async {
    final ch = channel ?? const MethodChannel('astramai/bridge');
    try {
      final result = await ch.invokeMethod<Map>('features');
      // 保留读取：以后要按别的条件隐藏时还用得上
      applicationId = result?['applicationId'] as String? ?? '';
      versionName = result?['versionName'] as String? ?? '';
    } catch (_) {
      // iOS / 鸿蒙没有这个通道 —— 网桥本来也只有 Android 有
      applicationId = '';
    }
  }

  /// 用系统浏览器打开网址。
  ///
  /// 走 MethodChannel 而不是 url_launcher：后者对鸿蒙是又一个要适配的
  /// 插件，而我们只要一个 Intent。
  static Future<bool> openUrl(String url) async {
    const ch = MethodChannel('astramai/bridge');
    try {
      await ch.invokeMethod<bool>('openUrl', {'url': url});
      return true;
    } catch (_) {
      return false;
    }
  }

  Future<dynamic> _onNativeCall(MethodCall call) async {
    if (call.method == 'stateChanged') {
      final args = Map<String, dynamic>.from(call.arguments as Map);
      onStatusChanged?.call(
        BridgeStatus(
          state: args['state'] as String? ?? 'STOPPED',
          text: args['text'] as String? ?? '',
          nodeName: args['nodeName'] as String?,
          error: args['error'] as String?,
        ),
      );
    }
    return null;
  }

  /// 启动网桥。
  Future<BridgeStatus> start() async {
    final result = await _channel.invokeMethod<Map>('start');
    return _toStatus(result);
  }

  /// 停止网桥。
  Future<BridgeStatus> stop() async {
    final result = await _channel.invokeMethod<Map>('stop');
    return _toStatus(result);
  }

  /// 查当前状态。
  Future<BridgeStatus> status() async {
    final result = await _channel.invokeMethod<Map>('status');
    return _toStatus(result);
  }

  BridgeStatus _toStatus(Map? map) => BridgeStatus(
        state: map?['state'] as String? ?? 'STOPPED',
        text: map?['text'] as String? ?? '',
        nodeName: map?['nodeName'] as String?,
      );
}

/// 网桥状态。
class BridgeStatus {
  const BridgeStatus({
    required this.state,
    required this.text,
    this.nodeName,
    this.error,
  });

  /// `STOPPED` / `WAITING_NODE` / `CONNECTED` / `ERROR`
  final String state;

  /// 可以直接显示的一行文字。
  final String text;

  /// 连上的设备名（比如「小米手环9 Pro」）。没连上是 null。
  final String? nodeName;

  final String? error;

  bool get running => state != 'STOPPED';
  bool get connected => state == 'CONNECTED';
}
