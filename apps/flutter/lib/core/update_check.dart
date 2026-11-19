import 'dart:convert';

import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

/// 版本检查与升级提醒。
///
/// ── 为什么要做 ──────────────────────────────────────────────────────
///
/// 服务端从阿里云搬到了机房，`BridgeChannel` 里那个默认地址也跟着换了域名。
/// **旧版 App 装的是老地址**，一旦旧机器下线，那些人就查不了分了。
///
/// 所以要让 App 自己发现「有新版本」，而不是等用户去官网看。
///
/// ── 数据源 ──────────────────────────────────────────────────────────
///
/// 读 R2 上的 `latest.json` —— 和官网、手表端共用同一份，发版只改一处。
///
/// ── 三条约束 ────────────────────────────────────────────────────────
///
/// 1. **绝不抛异常**：查版本失败不能影响查分
/// 2. **不阻塞启动**：网络慢不能拖住首屏
/// 3. **同一版本只提醒一次**：记在本地，别每次开都弹
class UpdateCheck {
  UpdateCheck._();

  /// 当前版本。跟 `pubspec.yaml` 的 version 保持一致。
  static const String currentVersion = '0.1.4';

  /// 发版清单。换 CDN 时要同步这里和手表端的 `update.js`。
  static const String manifestUrl =
      'https://orhythm-dl.astranexus.cn/latest.json';

  /// 「已经提示过哪个版本」的存储键。
  static const String _seenKey = 'updateSeenVersion';

  /// 查一次有没有新版本。
  ///
  /// 任何异常都吞掉并返回 `null` —— 查版本失败不该影响任何功能。
  static Future<UpdateInfo?> check() async {
    try {
      final response = await http
          .get(
            Uri.parse(manifestUrl),
            headers: const {'Cache-Control': 'no-cache'},
          )
          .timeout(const Duration(seconds: 6));

      if (response.statusCode != 200) return null;

      final body = jsonDecode(utf8.decode(response.bodyBytes));
      if (body is! Map) return null;

      final latest = (body['version'] ?? currentVersion)
          .toString()
          .replaceFirst(RegExp(r'^v', caseSensitive: false), '');

      final highlight =
          (body['highlight'] ?? body['changelogSummary'] ?? '').toString();

      return UpdateInfo(
        latest: latest,
        current: currentVersion,
        hasUpdate: compareVersion(latest, currentVersion) > 0,
        highlight: highlight,
      );
    } catch (_) {
      return null;
    }
  }

  /// 这个版本是否已经提醒过。
  static Future<bool> alreadyReminded(String version) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      return (prefs.getString(_seenKey) ?? '') == version;
    } catch (_) {
      return false;
    }
  }

  /// 记下「提醒过了」。
  static Future<void> markReminded(String version) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_seenKey, version);
    } catch (_) {
      // 记不住就记不住，下次再弹
    }
  }

  /// 比较两个 `x.y.z` 版本号。
  ///
  /// 只处理我们实际在用的格式，不追求语义化版本的完整规则 ——
  /// 为这个引一个依赖不值得。
  static int compareVersion(String a, String b) {
    final pa = a.split('.').map((e) => int.tryParse(e) ?? 0).toList();
    final pb = b.split('.').map((e) => int.tryParse(e) ?? 0).toList();
    for (var i = 0; i < 3; i++) {
      final x = i < pa.length ? pa[i] : 0;
      final y = i < pb.length ? pb[i] : 0;
      if (x > y) return 1;
      if (x < y) return -1;
    }
    return 0;
  }
}

/// 一次版本检查的结果。
class UpdateInfo {
  const UpdateInfo({
    required this.latest,
    required this.current,
    required this.hasUpdate,
    required this.highlight,
  });

  final String latest;
  final String current;
  final bool hasUpdate;

  /// 给玩家看的一句话说明，来自 manifest 的 `highlight`。
  final String highlight;
}
