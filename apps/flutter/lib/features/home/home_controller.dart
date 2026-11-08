import 'dart:async';

import 'package:flutter/foundation.dart';

import '../../core/api_client.dart';
import '../../core/endpoints.dart';
import '../../core/models.dart';
import '../../data/maimai_repository.dart';
import '../../data/profile_store.dart';

/// 一个游戏在首页卡片上要显示的东西。
///
/// ── 为什么要有这个中间层 ────────────────────────────────────────────
///
/// 四个游戏的数据结构完全不同：舞萌是 B50（35+15 条），中二是
/// B30+Selection10+Recent10，osu 是 Best Plays，Phigros 是 RKS 列表。
///
/// 如果首页直接按游戏分支，每加一个游戏就要改一次首页 ——
/// 而且以后 iOS / 鸿蒙两套 UI 都要各改一次。
///
/// 所以统一成这个「摘要」：
///
///   玩家名 + 一个大数字 + 段位 + 两三个小指标 + 前几条成绩
///
/// 三套 UI 只认这个结构。
class GameSummary {
  const GameSummary({
    required this.game,
    this.playerName = '',
    this.primaryValue = '',
    this.tierLabel,
    this.tierColor,
    this.extras = const [],
    this.topScores = const [],
    this.loading = false,
    this.error,
    this.bound = false,
    this.needsLogin = false,
  });

  final GameId game;

  final String playerName;

  /// 主数字的字符串形式（已经格式化好的）。
  ///
  /// 舞萌是 `15023`，中二是 `15.23`，osu 是 `5231`。
  /// 不同游戏精度不同，所以这里存字符串而不是数字。
  final String primaryValue;

  final String? tierLabel;
  final String? tierColor;

  /// 小指标（标签 + 值），最多显示三个。
  final List<(String, String)> extras;

  /// 成绩列表（首页下半部分用）。
  ///
  /// 舞萌 50 条 / 中二 30 条 / osu 50 条。不是只取前三条 ——
  /// head 卡片只占顶部，下面整个列表都要用这份数据。
  final List<SummaryScore> topScores;

  final bool loading;
  final String? error;
  final bool bound;
  final bool needsLogin;

  /// 有没有东西可展示。
  bool get hasData => primaryValue.isNotEmpty && error == null;
}

/// 卡片预览用的极简成绩。
class SummaryScore {
  const SummaryScore({
    required this.title,
    required this.detail,
    required this.value,
    this.jacketUrl = '',
    this.levelIndex = 3,
  });

  final String title;

  /// 难度 + 定数，比如 `Master 14.2`。
  final String detail;

  /// Rating / pp。
  final String value;

  final String jacketUrl;
  final int levelIndex;
}

/// 首页状态。
///
/// 不 import material —— 三套 UI 共用。
class HomeController extends ChangeNotifier {
  HomeController({MaimaiRepository? maimai})
      : _maimai = maimai ?? MaimaiRepository();

  final MaimaiRepository _maimai;

  /// 当前显示第几个游戏的卡片。
  int _index = 0;
  int get index => _index;

  /// 各游戏的摘要。键是游戏 id。
  final Map<GameId, GameSummary> _summaries = {};
  Map<GameId, GameSummary> get summaries => Map.unmodifiable(_summaries);

  /// 绑定。空表示没绑定。
  Map<GameId, String> _bindings = {};
  Map<GameId, String> get bindings => Map.unmodifiable(_bindings);

  bool _ready = false;
  bool get ready => _ready;

  /// 首页展示哪些游戏。
  ///
  /// 四个都展示，没绑定的显示「去绑定」。
  /// **不要只显示已绑定的** —— 新用户不知道这个 App 支持哪些游戏。
  List<GameId> get games => GameId.values;

  GameSummary summaryOf(GameId game) =>
      _summaries[game] ??
      GameSummary(game: game, bound: _bindings.containsKey(game));

  /// 读取本地绑定，然后拉数据。
  Future<void> init() async {
    _bindings = await ProfileStore.loadAll();
    _ready = true;
    notifyListeners();

    await refreshAll();
  }

  /// 切到某张卡片。
  void select(int index) {
    if (index == _index) return;
    _index = index;
    notifyListeners();
  }

  /// 拉所有已绑定游戏的数据。
  Future<void> refreshAll() async {
    for (final game in _bindings.keys) {
      unawaited(refresh(game));
    }
  }

  /// 拉一个游戏。
  Future<void> refresh(GameId game) async {
    final binding = _bindings[game];
    if (binding == null || binding.trim().isEmpty) return;

    _summaries[game] = GameSummary(game: game, loading: true, bound: true);
    notifyListeners();

    try {
      final summary = switch (game) {
        GameId.maimai => await _loadMaimai(binding),
        GameId.chunithm => await _loadChunithm(binding),
        GameId.osu => await _loadOsu(binding),
        // Phigros 要扫码登录，首页先只显示入口
        GameId.phigros => GameSummary(
            game: game,
            bound: true,
            needsLogin: true,
            playerName: '需要登录',
          ),
      };

      _summaries[game] = summary;
    } on ApiException catch (e) {
      _summaries[game] = GameSummary(
        game: game,
        bound: true,
        error: e.message,
      );
    } catch (e) {
      _summaries[game] = GameSummary(
        game: game,
        bound: true,
        error: '出错了：$e',
      );
    } finally {
      notifyListeners();
    }
  }

  /// 绑定并查询。
  Future<void> bind(GameId game, String value) async {
    await ProfileStore.save(game, value);
    if (value.trim().isEmpty) {
      _bindings.remove(game);
      _summaries.remove(game);
      notifyListeners();
      return;
    }
    _bindings[game] = value.trim();
    notifyListeners();
    await refresh(game);
  }

  // ── 各游戏的适配 ────────────────────────────────────────────────────

  Future<GameSummary> _loadMaimai(String binding) async {
    final friendCode = int.tryParse(binding);
    final view = friendCode != null && binding.length >= 10
        ? await _maimai.b50ByFriendCode(friendCode)
        : await _maimai.b50ByQq(binding);

    final scores = [...view.standard, ...view.dx]
      ..sort((a, b) => (b.rating ?? 0).compareTo(a.rating ?? 0));

    return GameSummary(
      game: GameId.maimai,
      bound: true,
      playerName: view.player.name,
      primaryValue: '${view.player.rating}',
      tierLabel: view.player.tier?.label,
      tierColor: view.player.tier?.color,
      extras: [
        ('旧曲', '${view.stats.standardTotal}'),
        ('新曲', '${view.stats.dxTotal}'),
        ('平均定数', view.stats.averageLevelValue.toStringAsFixed(2)),
      ],
      topScores: scores.take(50).map(_toSummaryScore).toList(),
    );
  }

  Future<GameSummary> _loadChunithm(String binding) async {
    // 中二和舞萌共用 readPlayerParams（code / qq）
    final query = binding.length >= 10
        ? 'code=${Uri.encodeComponent(binding)}'
        : 'qq=${Uri.encodeComponent(binding)}';

    final envelope = await _api.get<Map<String, dynamic>>(
      '${Endpoints.chunithmBests}?$query',
      parse: (json) => json,
    );

    final data = envelope.data ?? const <String, dynamic>{};
    final player = data['player'] as Map<String, dynamic>? ?? const {};
    final stats = data['stats'] as Map<String, dynamic>? ?? const {};

    final rating = (player['rating'] as num?)?.toDouble() ?? 0;
    final bests = (data['bests'] as List?) ?? const [];

    return GameSummary(
      game: GameId.chunithm,
      bound: true,
      playerName: player['name'] as String? ?? '',
      primaryValue: rating.toStringAsFixed(2),
      extras: [
        ('最高', ((stats['maxRating'] as num?) ?? 0).toStringAsFixed(2)),
        ('B30 均', ((stats['averageRating'] as num?) ?? 0).toStringAsFixed(2)),
      ],
      topScores: bests.take(30).map((raw) {
        final item = raw as Map<String, dynamic>;
        return SummaryScore(
          title: item['title'] as String? ?? '',
          detail:
              '${item['difficultyShort'] ?? ''} ${item['level'] ?? ''}'.trim(),
          value: ((item['rating'] as num?) ?? 0).toStringAsFixed(2),
          jacketUrl: item['jacketUrl'] as String? ?? '',
        );
      }).toList(),
    );
  }

  Future<GameSummary> _loadOsu(String binding) async {
    final envelope = await _api.get<Map<String, dynamic>>(
      '${Endpoints.osuBests}?username=${Uri.encodeComponent(binding)}',
      parse: (json) => json,
    );

    final data = envelope.data ?? const <String, dynamic>{};
    final player = data['player'] as Map<String, dynamic>? ?? const {};
    final plays = (data['plays'] as List?) ?? const [];

    final pp = (player['pp'] as num?)?.toDouble() ?? 0;

    return GameSummary(
      game: GameId.osu,
      bound: true,
      playerName: player['username'] as String? ?? binding,
      primaryValue: pp.toStringAsFixed(0),
      tierLabel: player['rank'] as String?,
      extras: [
        ('准确率', ((player['accuracy'] as num?) ?? 0).toStringAsFixed(2)),
        ('等级', '${player['level'] ?? 0}'),
      ],
      topScores: plays.take(50).map((raw) {
        final item = raw as Map<String, dynamic>;
        return SummaryScore(
          title: item['title'] as String? ?? '',
          detail: '${item['artist'] ?? ''}',
          value: ((item['pp'] as num?) ?? 0).toStringAsFixed(0),
        );
      }).toList(),
    );
  }

  static SummaryScore _toSummaryScore(MaimaiScore score) => SummaryScore(
        title: score.title,
        detail: '${score.difficultyShort} ${score.level}'.trim(),
        value: score.rating == null ? '—' : '${score.rating}',
        jacketUrl: score.jacketUrl,
        levelIndex: score.levelIndex,
      );

  /// 通用的 HTTP 客户端（中二 / osu 用）。
  final _api = ApiClient();

  @override
  void dispose() {
    _maimai.dispose();
    _api.dispose();
    super.dispose();
  }
}
