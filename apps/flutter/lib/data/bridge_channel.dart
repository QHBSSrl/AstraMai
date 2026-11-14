import 'package:flutter/services.dart';

/// 手机↔手表 网桥的控制通道。
///
/// ── 为什么只有三个方法 ──────────────────────────────────────────────
///
/// 真正的收发全在 Kotlin 里跑（`WearableBridge`）。Dart 这边只负责
/// 开关和展示状态 —— **每一条消息都过一次 MethodChannel 会白白多一层延迟**，
/// 而手表那边对延迟敏感。
///
/// 所以：
///   · Dart  → 启动 / 停止 / 查状态
///   · Kotlin→ 收到帧直接在原生侧发 HTTP，不回到 Dart
class BridgeChannel {
  BridgeChannel({MethodChannel? channel})
      : _channel = channel ?? const MethodChannel('astramai/bridge') {
    _channel.setMethodCallHandler(_onNativeCall);
  }

  final MethodChannel _channel;

  /// 原生侧主动推状态变更时回调。
  void Function(BridgeStatus status)? onStatusChanged;

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
