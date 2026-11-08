import '../core/api_client.dart';
import '../core/endpoints.dart';
import '../core/models.dart';

/// 舞萌数据仓库。
///
/// ── 为什么要这一层 ──────────────────────────────────────────────────
///
/// 页面不该直接拼 URL、拼查询参数。所有"怎么问服务端"的知识都在这里，
/// 以后换端点（比如加 compact 版本）、加缓存、加重试都只改这一个文件。
///
/// 它**不依赖任何 UI** —— 所以 iOS / 鸿蒙换 UI 时这层一行不用动。
class MaimaiRepository {
  MaimaiRepository({ApiClient? client}) : _client = client ?? ApiClient();

  final ApiClient _client;

  /// 按好友码查 B50。
  Future<MaimaiB50View> b50ByFriendCode(int friendCode) {
    return _fetch('code=$friendCode');
  }

  /// 按 QQ 号查 B50。
  Future<MaimaiB50View> b50ByQq(String qq) {
    return _fetch('qq=${Uri.encodeComponent(qq)}');
  }

  Future<MaimaiB50View> _fetch(String query) async {
    final envelope = await _client.get<MaimaiB50View>(
      '${Endpoints.maimaiB50}?$query',
      parse: MaimaiB50View.fromJson,
    );

    final view = envelope.data;
    if (view == null) {
      throw const ApiException('服务器没返回成绩数据');
    }
    return view;
  }

  void dispose() => _client.dispose();
}
