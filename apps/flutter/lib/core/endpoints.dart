/// 接口路径。
///
/// ── 为什么集中在这里 ────────────────────────────────────────────────
///
/// 路径散落在各个页面里的话，服务端改一个路由要满仓库找。集中一处，
/// 换版本（`/api/maimai/*` 是历史路径，`/api/v1/*` 是新协议）时只改这里。
class Endpoints {
  const Endpoints._();

  /// 舞萌 B50。
  ///
  /// 用查询参数而不是路径参数 —— 好友码和 QQ 号共用一个入口。
  /// 路径参数版本（`/api/maimai/b50/:code`）是历史遗留，还在但不用了。
  static const String maimaiB50 = '/api/v1/maimai/b50';

  /// 中二节奏（B30 + Selection10 + Recent10）。
  static const String chunithmBests = '/api/v1/chunithm/bests';

  /// Phigros 成绩（要 X-Phigros-Session 头）。
  static const String phigrosBests = '/api/v1/phigros/bests';

  /// Phigros 出码。
  static const String phigrosQr = '/api/v1/phigros/qr';

  /// osu! Best Plays。
  static const String osuBests = '/api/v1/osu/bests';

  /// 舞萌曲库。
  static const String maimaiSongs = '/api/v1/maimai/songs';

  /// 舞萌曲目搜索。
  static const String maimaiSearch = '/api/v1/maimai/search';

  /// 中二曲库。
  static const String chunithmSongs = '/api/v1/chunithm/songs';

  /// 中二曲目搜索。
  static const String chunithmSearch = '/api/v1/chunithm/search';

  /// 健康检查。
  static const String health = '/api/health';

  /// 数据源清单。
  static const String sources = '/api/v1/sources';

  /// 舞萌 B50 瘦身版。
  ///
  /// ⚠️ 这个端点是给**手环的网桥**用的（88 KB → 12 KB，塞进 16 KB 单消息上限）。
  /// 手机端能直接联网，**应该用完整版** —— 瘦身版砍掉了别名、物量、推分中间值。
  static const String maimaiB50Compact = '/api/v1/maimai/b50/compact';
}
