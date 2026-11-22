import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

/// 日志收集与上传。**只在 debug 包里启用。**
///
/// ── 为什么要有这个东西 ────────────────────────────────────────────
///
/// 测试用户反馈「开了网桥还是用不了」，但我们手上只有一句转述。
/// 没有日志就只能靠猜 —— 到底是插件没装、通道没起来、请求超时，
/// 还是数据格式不对，全靠运气。
///
/// 所以：把最近的日志缓在内存里，出事时连同前后几十行一起传上来，
/// 放到内部站点上看。
///
/// ── 边界 ────────────────────────────────────────────────────────
///
/// · **只在 `kDebugMode` 启用** —— release 包一行日志都不发，
///   免得占用户流量、也免得把用户的东西传到我们这儿。
/// · 只保留最近 [maxEntries] 行，内存占用可控。
/// · 上传失败**绝不影响主流程**：吞掉异常，不弹提示。
/// · 不带任何硬件标识 —— [deviceId] 是本地随机生成的串。
class LogUploader {
  LogUploader._();

  /// 阿里云直连（明文）。日志不含凭证，走 HTTP 省事。
  static const String uploadUrl = 'http://101.132.148.117:8787/api/logs';

  /// 只在 debug 包启用。
  static bool enabled = kDebugMode;

  /// 环形缓冲上限。500 行足够看清一次交互。
  static const int maxEntries = 500;

  /// 单条日志最长保留字符数，防止一行巨大的 JSON 撑爆缓冲。
  static const int maxLineLength = 800;

  static final List<_Entry> _buffer = <_Entry>[];
  static String _deviceId = '';
  static bool _installed = false;

  /// 挂上 `debugPrint` 和全局错误钩子。**在 `runApp` 之前调用。**
  static void install() {
    if (!enabled || _installed) return;
    _installed = true;

    // 接管 debugPrint：所有 print 最终都会走到这里
    debugPrint = (String? message, {int? wrapWidth}) {
      if (message != null) {
        _push('log', message);
        // 保留原始输出，控制台还是能看
        // ignore: avoid_print
        print(message);
      }
    };

    // 未捕获的 Flutter 错误
    final previous = FlutterError.onError;
    FlutterError.onError = (FlutterErrorDetails details) {
      _push('error', '${details.exception}\n${details.stack ?? ''}');
      previous?.call(details);
    };

    // 异步未捕获错误
    PlatformDispatcher.instance.onError = (Object error, StackTrace stack) {
      _push('error', '异步异常：$error\n$stack');
      unawaited(report('uncaught', message: '$error', stack: '$stack'));
      return false;
    };
  }

  /// 打一条「阶段标记」。比 log 显眼，在时间线上好找。
  static void mark(String message) => _push('mark', message);

  static void warn(String message) => _push('warn', message);

  static void error(String message) => _push('error', message);

  static void _push(String level, String message) {
    if (!enabled) return;

    final text = message.length > maxLineLength
        ? '${message.substring(0, maxLineLength)}…'
        : message;

    _buffer.add(_Entry(DateTime.now().millisecondsSinceEpoch, level, text));
    if (_buffer.length > maxEntries) {
      _buffer.removeRange(0, _buffer.length - maxEntries);
    }
  }

  /// 本地随机设备标识。**不是硬件 ID** —— 只是为了把同一个用户的多次上报串起来。
  static Future<String> deviceId() async {
    if (_deviceId.isNotEmpty) return _deviceId;
    try {
      final prefs = await SharedPreferences.getInstance();
      final saved = prefs.getString('logDeviceId');
      if (saved != null && saved.isNotEmpty) {
        _deviceId = saved;
        return _deviceId;
      }
      final rnd = Random.secure();
      final id = List<int>.generate(8, (_) => rnd.nextInt(256))
          .map((b) => b.toRadixString(16).padLeft(2, '0'))
          .join();
      await prefs.setString('logDeviceId', id);
      _deviceId = id;
      return id;
    } catch (_) {
      // 存储不可用就退回进程内随机值
      _deviceId = DateTime.now().millisecondsSinceEpoch.toRadixString(16);
      return _deviceId;
    }
  }

  /// 上传一次。失败**静默**，不影响调用方。
  ///
  /// [scope] 出错的页面/模块，[message]/[stack] 是错误本身。
  static Future<bool> report(
    String scope, {
    String? message,
    String? stack,
    String phase = 'after',
  }) async {
    if (!enabled) return false;

    mark('上报 → $scope');
    try {
      final body = jsonEncode({
        'device': await deviceId(),
        'scope': scope,
        if (message != null) 'message': message,
        if (stack != null) 'stack': stack,
        'at': DateTime.now().millisecondsSinceEpoch,
        'phase': phase,
        'entries': _buffer
            .map((e) => {'t': e.t, 'lv': e.level, 'm': e.message})
            .toList(),
      });

      final res = await http
          .post(
            Uri.parse(uploadUrl),
            headers: {'content-type': 'application/json; charset=utf-8'},
            body: utf8.encode(body),
          )
          .timeout(const Duration(seconds: 12));

      return res.statusCode == 200;
    } catch (_) {
      // 上传失败不能反过来打扰用户
      return false;
    }
  }

  /// 给网桥流程用的便捷入口：把一次网桥交互的结论报上来。
  static Future<bool> reportBridge(String step, {String? detail, bool ok = false}) {
    mark(ok ? '网桥 $step 成功' : '网桥 $step 失败');
    return report(
      'bridge:$step',
      message: detail ?? (ok ? 'ok' : 'failed'),
      phase: 'after',
    );
  }
}

class _Entry {
  _Entry(this.t, this.level, this.message);

  final int t;
  final String level;
  final String message;
}
