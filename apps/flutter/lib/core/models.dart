// 数据模型。
//
// ── 为什么和手表端（TypeScript）长得一样 ──────────────────────────────
//
// 因为**上游是同一个** —— 服务端（apps/server）负责把落雪、中二、Phigros、
// osu 的原始响应归一化成视图模型，客户端只管渲染。
//
// Android 端不需要理解落雪的字段，只要理解**我们自己的视图模型**。
// 这样以后换数据源（比如加水鱼），客户端一行不用改。
//
// ⚠️ 字段名要和服务端的 JSON 一致。改服务端的 buildB50View 时这里也要跟着改，
// 而且**编译期发现不了**，只能靠运行。

/// 服务端统一的响应信封。
///
/// 字段名严格对齐：`ok` / `success` / `mode` / `source` / `data` /
/// `message` / `error`。
class Envelope<T> {
  const Envelope({
    this.ok = false,
    this.success = false,
    this.mode = '',
    this.source = '',
    this.elapsedMs = 0,
    this.data,
    this.message,
    this.error,
  });

  final bool ok;
  final bool success;
  final String mode;
  final String source;
  final int elapsedMs;
  final T? data;
  final String? message;
  final ApiError? error;

  /// 把各种错误形状统一成一句人话。
  ///
  /// 服务端有两种错误形状：
  ///   · 新的 `{error: {kind, message, friendlyMessage}}`
  ///   · 旧的 `{message: '...'}`
  /// 两个都要兜住，不然用户会看到「请求失败」这种没信息量的提示。
  String errorMessage() {
    final e = error;
    if (e != null) {
      if (e.friendlyMessage.isNotEmpty) return e.friendlyMessage;
      if (e.message.isNotEmpty) return e.message;
    }
    if (message != null && message!.isNotEmpty) return message!;
    return '请求失败';
  }
}

/// 错误详情。
class ApiError {
  const ApiError({
    this.kind = '',
    this.message = '',
    this.friendlyMessage = '',
    this.detail = '',
    this.status = 0,
  });

  final String kind;
  final String message;
  final String friendlyMessage;
  final String detail;
  final int status;

  factory ApiError.fromJson(Map<String, dynamic> json) => ApiError(
        kind: json['kind'] as String? ?? '',
        message: json['message'] as String? ?? '',
        friendlyMessage: json['friendlyMessage'] as String? ?? '',
        detail: json['detail'] as String? ?? '',
        status: (json['status'] as num?)?.toInt() ?? 0,
      );
}

// ══════════════════════════════════════════════════════════════════════
// 舞萌 DX
// ══════════════════════════════════════════════════════════════════════

class Tier {
  const Tier({this.label = '', this.color = '', this.index = 0});

  final String label;
  final String color;
  final int index;

  factory Tier.fromJson(Map<String, dynamic> json) => Tier(
        label: json['label'] as String? ?? '',
        color: json['color'] as String? ?? '',
        index: (json['index'] as num?)?.toInt() ?? 0,
      );
}

class MaimaiPlayer {
  const MaimaiPlayer({
    this.name = '',
    this.rating = 0,
    this.friendCode = 0,
    this.tier,
  });

  final String name;
  final int rating;
  final int friendCode;
  final Tier? tier;

  factory MaimaiPlayer.fromJson(Map<String, dynamic> json) => MaimaiPlayer(
        name: json['name'] as String? ?? '',
        rating: (json['rating'] as num?)?.toInt() ?? 0,
        friendCode: (json['friendCode'] as num?)?.toInt() ?? 0,
        tier: json['tier'] is Map<String, dynamic>
            ? Tier.fromJson(json['tier'] as Map<String, dynamic>)
            : null,
      );
}

/// 一条成绩。
///
/// 字段名对齐服务端 `buildB50View` 的输出。
class MaimaiScore {
  const MaimaiScore({
    this.songId = 0,
    this.title = '',
    this.artist = '',
    this.jacketUrl = '',
    this.songType = '',
    this.levelIndex = 0,
    this.difficultyShort = '',
    this.level = '',
    this.levelValue,
    this.achievements = 0,
    this.rate = '',
    this.dxScore = 0,
    this.dxStar = 0,
    this.fc = '',
    this.fs = '',
    this.rating,
    this.computedRating,
    this.maxRating,
    this.headroom,
    this.songVersionTitle = '',
    this.noteDesigner = '',
  });

  final int songId;
  final String title;
  final String artist;
  final String jacketUrl;

  /// "DX" 或 "SD"。
  final String songType;

  /// 0=Basic 1=Advanced 2=Expert 3=Master 4=Re:Master
  final int levelIndex;
  final String difficultyShort;
  final String level;

  /// 定数（14.2 这种）。
  final double? levelValue;

  final double achievements;
  final String rate;
  final int dxScore;
  final int dxStar;
  final String fc;
  final String fs;

  /// 单曲 Rating —— **落雪给的**，不是我们算的。
  final int? rating;

  /// 我们按公式算的，用来和上面对拍。
  final int? computedRating;
  final int? maxRating;

  /// 离满分的差距，推分页用。
  final double? headroom;

  final String songVersionTitle;
  final String noteDesigner;

  factory MaimaiScore.fromJson(Map<String, dynamic> json) => MaimaiScore(
        songId: (json['songId'] as num?)?.toInt() ?? 0,
        title: json['title'] as String? ?? '',
        artist: json['artist'] as String? ?? '',
        jacketUrl: json['jacketUrl'] as String? ?? '',
        songType: json['type'] as String? ?? '',
        levelIndex: (json['levelIndex'] as num?)?.toInt() ?? 0,
        difficultyShort: json['difficultyShort'] as String? ?? '',
        level: json['level'] as String? ?? '',
        levelValue: (json['levelValue'] as num?)?.toDouble(),
        achievements: (json['achievements'] as num?)?.toDouble() ?? 0,
        rate: json['rate'] as String? ?? '',
        dxScore: (json['dxScore'] as num?)?.toInt() ?? 0,
        dxStar: (json['dxStar'] as num?)?.toInt() ?? 0,
        fc: json['fc'] as String? ?? '',
        fs: json['fs'] as String? ?? '',
        rating: (json['rating'] as num?)?.toInt(),
        computedRating: (json['computedRating'] as num?)?.toInt(),
        maxRating: (json['maxRating'] as num?)?.toInt(),
        headroom: (json['headroom'] as num?)?.toDouble(),
        songVersionTitle: json['songVersionTitle'] as String? ?? '',
        noteDesigner: json['noteDesigner'] as String? ?? '',
      );
}

class MaimaiStats {
  const MaimaiStats({
    this.standardTotal = 0,
    this.dxTotal = 0,
    this.totalRating = 0,
    this.averageLevelValue = 0,
    this.bestsCount = 0,
    this.computedDelta = 0,
  });

  final int standardTotal;
  final int dxTotal;
  final int totalRating;
  final double averageLevelValue;
  final int bestsCount;

  /// 我们算的和落雪给的对不对得上。0 表示一致。
  final int computedDelta;

  factory MaimaiStats.fromJson(Map<String, dynamic> json) => MaimaiStats(
        standardTotal: (json['standardTotal'] as num?)?.toInt() ?? 0,
        dxTotal: (json['dxTotal'] as num?)?.toInt() ?? 0,
        totalRating: (json['totalRating'] as num?)?.toInt() ?? 0,
        averageLevelValue:
            (json['averageLevelValue'] as num?)?.toDouble() ?? 0,
        bestsCount: (json['bestsCount'] as num?)?.toInt() ?? 0,
        computedDelta: (json['computedDelta'] as num?)?.toInt() ?? 0,
      );
}

/// B50 视图。
class MaimaiB50View {
  const MaimaiB50View({
    this.player = const MaimaiPlayer(),
    this.stats = const MaimaiStats(),
    this.standard = const [],
    this.dx = const [],
  });

  final MaimaiPlayer player;
  final MaimaiStats stats;

  /// 旧曲 B35
  final List<MaimaiScore> standard;

  /// 新曲 B15
  final List<MaimaiScore> dx;

  /// 合成一个按 Rating 降序的列表 —— 和手表端 `applyMaimai` 一样的顺序。
  List<MaimaiScore> get allSorted {
    final all = [...standard, ...dx];
    all.sort((a, b) => (b.rating ?? 0).compareTo(a.rating ?? 0));
    return all;
  }

  factory MaimaiB50View.fromJson(Map<String, dynamic> json) => MaimaiB50View(
        player: json['player'] is Map<String, dynamic>
            ? MaimaiPlayer.fromJson(json['player'] as Map<String, dynamic>)
            : const MaimaiPlayer(),
        stats: json['stats'] is Map<String, dynamic>
            ? MaimaiStats.fromJson(json['stats'] as Map<String, dynamic>)
            : const MaimaiStats(),
        standard: (json['standard'] as List?)
                ?.whereType<Map<String, dynamic>>()
                .map(MaimaiScore.fromJson)
                .toList() ??
            const [],
        dx: (json['dx'] as List?)
                ?.whereType<Map<String, dynamic>>()
                .map(MaimaiScore.fromJson)
                .toList() ??
            const [],
      );
}
