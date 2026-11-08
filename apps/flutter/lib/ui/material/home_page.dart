import 'package:flutter/material.dart';

import '../../data/profile_store.dart';
import '../../features/home/home_controller.dart';
import '../theme.dart';

/// 首页（Material 3 实现）。
///
/// ── 布局 ────────────────────────────────────────────────────────────
///
/// head 卡片**只占顶部一块**，下面是当前游戏的成绩列表：
///
///   ┌─────────────────────────┐
///   │ AstraMai            ⟳   │
///   │ ┌─────────────────────┐ │
///   │ │ 舞萌 DX        [虹]  │ │
///   │ │ QBHSSrl             │ │
///   │ │  15,023  DX Rating  │ │  ← head 卡片，固定高度
///   │ │ 旧曲8396 新曲3642    │ │
///   │ └─────────────────────┘ │
///   │     ● ○ ○ ○             │
///   ├─────────────────────────┤
///   │ B50             按Rating │
///   │ ┌─────────────────────┐ │
///   │ │▎曲名   Mas 14.2  298│ │  ← 列表，跟着卡片切换
///   │ └─────────────────────┘ │
///   │ ┌─────────────────────┐ │
///   │ │▎曲名   Exp 13.5  271│ │
///   │ └─────────────────────┘ │
///   └─────────────────────────┘
///
/// ⚠️ 第一版我做成了「整页一张卡片」，那是错的 ——
/// head 是页头，不是页面本身。
class HomePage extends StatefulWidget {
  const HomePage({super.key});

  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> {
  final _controller = HomeController();
  final _pageController = PageController();

  /// head 卡片区的高度。
  ///
  /// 固定而不是让内容撑 —— 不然切到一个没绑定的游戏时卡片会突然变高，
  /// 下面的列表跟着跳，很晃眼睛。
  static const double _headHeight = 176;

  @override
  void initState() {
    super.initState();
    _controller.init();
  }

  @override
  void dispose() {
    _controller.dispose();
    _pageController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, _) {
        final scheme = Theme.of(context).colorScheme;
        final current = _controller.games[_controller.index];
        final summary = _controller.summaryOf(current);

        return Scaffold(
          backgroundColor: scheme.surface,
          body: SafeArea(
            bottom: false,
            child: CustomScrollView(
              slivers: [
                SliverToBoxAdapter(child: _buildHeader(context)),

                // ── head 卡片区（横向滑动）──────────────────────────────
                SliverToBoxAdapter(
                  child: SizedBox(
                    height: _headHeight,
                    child: PageView.builder(
                      controller: _pageController,
                      itemCount: _controller.games.length,
                      onPageChanged: _controller.select,
                      itemBuilder: (context, index) {
                        final game = _controller.games[index];
                        return _HeadCard(
                          summary: _controller.summaryOf(game),
                          onBind: () => _showBindSheet(game),
                          onRetry: () => _controller.refresh(game),
                        );
                      },
                    ),
                  ),
                ),

                SliverToBoxAdapter(child: _buildIndicator(context)),
                SliverToBoxAdapter(child: _buildListHeader(context, summary)),

                // ── 列表（跟着 head 切换）──────────────────────────────
                if (summary.loading)
                  const SliverFillRemaining(
                    hasScrollBody: false,
                    child: Center(child: CircularProgressIndicator()),
                  )
                else if (summary.topScores.isEmpty)
                  SliverFillRemaining(
                    hasScrollBody: false,
                    child: _EmptyList(summary: summary),
                  )
                else
                  SliverList.builder(
                    itemCount: summary.topScores.length,
                    itemBuilder: (context, index) => Padding(
                      padding: EdgeInsets.fromLTRB(
                        16,
                        index == 0 ? 4 : 4,
                        16,
                        index == summary.topScores.length - 1 ? 24 : 0,
                      ),
                      child: _ScoreTile(score: summary.topScores[index]),
                    ),
                  ),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _buildHeader(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 8, 12, 0),
      child: Row(
        children: [
          Text(
            'AstraMai',
            style: Theme.of(context).textTheme.titleLarge?.copyWith(
                  fontWeight: FontWeight.w700,
                  letterSpacing: -0.5,
                ),
          ),
          const Spacer(),
          IconButton(
            onPressed: () => _controller.refreshAll(),
            icon: const Icon(Icons.refresh),
            tooltip: '刷新全部',
          ),
        ],
      ),
    );
  }

  Widget _buildIndicator(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 10),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          for (var i = 0; i < _controller.games.length; i++)
            AnimatedContainer(
              duration: const Duration(milliseconds: 220),
              margin: const EdgeInsets.symmetric(horizontal: 3),
              width: i == _controller.index ? 20 : 6,
              height: 6,
              decoration: BoxDecoration(
                color: i == _controller.index
                    ? scheme.primary
                    : scheme.outlineVariant,
                borderRadius: BorderRadius.circular(3),
              ),
            ),
        ],
      ),
    );
  }

  Widget _buildListHeader(BuildContext context, GameSummary summary) {
    final scheme = Theme.of(context).colorScheme;

    // 列表标题跟着游戏变
    final title = switch (summary.game) {
      GameId.maimai => 'B50',
      GameId.chunithm => 'B30',
      GameId.osu => 'Best Plays',
      GameId.phigros => 'RKS',
    };

    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 0, 8, 4),
      child: Row(
        children: [
          Text(
            title,
            style: Theme.of(context).textTheme.titleSmall?.copyWith(
                  color: scheme.onSurfaceVariant,
                  letterSpacing: 1,
                  fontWeight: FontWeight.w700,
                ),
          ),
          const Spacer(),
          if (summary.topScores.isNotEmpty)
            Text(
              '共 ${summary.topScores.length} 条',
              style: Theme.of(context)
                  .textTheme
                  .labelSmall
                  ?.copyWith(color: scheme.onSurfaceVariant),
            ),
        ],
      ),
    );
  }

  Future<void> _showBindSheet(GameId game) async {
    final current = _controller.bindings[game] ?? '';
    final input = TextEditingController(text: current);

    final result = await showModalBottomSheet<String>(
      context: context,
      isScrollControlled: true,
      showDragHandle: true,
      builder: (context) {
        final scheme = Theme.of(context).colorScheme;

        return Padding(
          padding: EdgeInsets.fromLTRB(
            24,
            0,
            24,
            24 + MediaQuery.viewInsetsOf(context).bottom,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                '绑定 ${game.label}',
                style: Theme.of(context).textTheme.titleLarge,
              ),
              const SizedBox(height: 4),
              Text(
                game == GameId.osu
                    ? '填 osu! 官网的用户名'
                    : '填游戏内的${game.bindingLabel}（10 位以上），或者填 QQ 号',
                style: Theme.of(context)
                    .textTheme
                    .bodySmall
                    ?.copyWith(color: scheme.onSurfaceVariant),
              ),
              const SizedBox(height: 16),
              TextField(
                controller: input,
                autofocus: true,
                keyboardType: game == GameId.osu
                    ? TextInputType.text
                    : TextInputType.number,
                decoration: InputDecoration(
                  labelText: game.bindingLabel,
                  border: const OutlineInputBorder(),
                ),
                onSubmitted: (v) => Navigator.of(context).pop(v),
              ),
              const SizedBox(height: 16),
              Row(
                children: [
                  if (current.isNotEmpty)
                    TextButton(
                      onPressed: () => Navigator.of(context).pop(''),
                      child: const Text('解绑'),
                    ),
                  const Spacer(),
                  FilledButton(
                    onPressed: () =>
                        Navigator.of(context).pop(input.text.trim()),
                    child: const Text('保存'),
                  ),
                ],
              ),
            ],
          ),
        );
      },
    );

    if (result == null) return;
    await _controller.bind(game, result);
  }
}

/// head 卡片 —— 只占顶部一条，不是整页。
class _HeadCard extends StatelessWidget {
  const _HeadCard({
    required this.summary,
    required this.onBind,
    required this.onRetry,
  });

  final GameSummary summary;
  final VoidCallback onBind;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
      child: Container(
        decoration: BoxDecoration(
          color: scheme.surfaceContainerLow,
          borderRadius: BorderRadius.circular(24),
        ),
        clipBehavior: Clip.antiAlias,
        child: summary.loading
            ? const Center(
                child: SizedBox(
                  width: 24,
                  height: 24,
                  child: CircularProgressIndicator(strokeWidth: 2.5),
                ),
              )
            : summary.error != null
                ? _ErrorHead(
                    message: summary.error!,
                    onRetry: onRetry,
                    onBind: onBind,
                  )
                : !summary.bound
                    ? _UnboundHead(game: summary.game, onBind: onBind)
                    : summary.needsLogin
                        ? _LoginHead(game: summary.game, onBind: onBind)
                        : _BoundHead(summary: summary),
      ),
    );
  }
}

class _BoundHead extends StatelessWidget {
  const _BoundHead({required this.summary});

  final GameSummary summary;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;

    final tierColor = summary.tierColor == null
        ? scheme.primary
        : _hex(summary.tierColor!) ?? scheme.primary;

    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Row(
            children: [
              Icon(_iconOf(summary.game), size: 16, color: scheme.primary),
              const SizedBox(width: 6),
              Text(
                summary.game.label,
                style: text.labelMedium?.copyWith(color: scheme.primary),
              ),
              const Spacer(),
              if (summary.tierLabel != null)
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                  decoration: BoxDecoration(
                    color: tierColor.withValues(alpha: 0.16),
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    summary.tierLabel!,
                    style: text.labelSmall?.copyWith(
                      color: tierColor,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
            ],
          ),
          const Spacer(),
          Text(
            summary.playerName,
            style: text.bodyMedium?.copyWith(
              color: scheme.onSurfaceVariant,
              fontWeight: FontWeight.w600,
            ),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
          Row(
            crossAxisAlignment: CrossAxisAlignment.baseline,
            textBaseline: TextBaseline.alphabetic,
            children: [
              Text(
                summary.primaryValue,
                style: text.displaySmall?.copyWith(
                  fontWeight: FontWeight.w800,
                  letterSpacing: -1.5,
                  fontFeatures: const [FontFeature.tabularFigures()],
                ),
              ),
              const SizedBox(width: 8),
              Padding(
                padding: const EdgeInsets.only(bottom: 4),
                child: Text(
                  summary.game.primaryLabel,
                  style:
                      text.labelSmall?.copyWith(color: scheme.onSurfaceVariant),
                ),
              ),
            ],
          ),
          const Spacer(),
          if (summary.extras.isNotEmpty)
            Row(
              children: [
                for (var i = 0; i < summary.extras.length; i++) ...[
                  if (i > 0) const SizedBox(width: 20),
                  Row(
                    children: [
                      Text(
                        summary.extras[i].$2,
                        style: text.labelMedium?.copyWith(
                          fontWeight: FontWeight.w700,
                          fontFeatures: const [FontFeature.tabularFigures()],
                        ),
                      ),
                      const SizedBox(width: 4),
                      Text(
                        summary.extras[i].$1,
                        style: text.labelSmall
                            ?.copyWith(color: scheme.onSurfaceVariant),
                      ),
                    ],
                  ),
                ],
              ],
            ),
        ],
      ),
    );
  }

  static Color? _hex(String hex) {
    final clean = hex.replaceAll('#', '');
    if (clean.length != 6) return null;
    final v = int.tryParse(clean, radix: 16);
    return v == null ? null : Color(0xFF000000 | v);
  }
}

class _UnboundHead extends StatelessWidget {
  const _UnboundHead({required this.game, required this.onBind});

  final GameId game;
  final VoidCallback onBind;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;

    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(_iconOf(game), size: 16, color: scheme.onSurfaceVariant),
              const SizedBox(width: 6),
              Text(
                game.label,
                style: text.labelMedium?.copyWith(
                  color: scheme.onSurfaceVariant,
                ),
              ),
            ],
          ),
          const Spacer(),
          Text(
            '还没绑定${game.bindingLabel}',
            style: text.bodyMedium?.copyWith(
              color: scheme.onSurfaceVariant,
            ),
          ),
          const SizedBox(height: 12),
          FilledButton.icon(
            onPressed: onBind,
            icon: const Icon(Icons.link, size: 16),
            label: Text('绑定${game.bindingLabel}'),
            style: FilledButton.styleFrom(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
              visualDensity: VisualDensity.compact,
            ),
          ),
        ],
      ),
    );
  }
}

class _LoginHead extends StatelessWidget {
  const _LoginHead({required this.game, required this.onBind});

  final GameId game;
  final VoidCallback onBind;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;

    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(_iconOf(game), size: 16, color: scheme.onSurfaceVariant),
              const SizedBox(width: 6),
              Text(
                game.label,
                style: text.labelMedium?.copyWith(
                  color: scheme.onSurfaceVariant,
                ),
              ),
            ],
          ),
          const Spacer(),
          Text(
            '需要扫码登录 TapTap',
            style: text.bodyMedium?.copyWith(color: scheme.onSurfaceVariant),
          ),
          const SizedBox(height: 12),
          FilledButton.icon(
            onPressed: onBind,
            icon: const Icon(Icons.qr_code, size: 16),
            label: const Text('登录'),
            style: FilledButton.styleFrom(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
              visualDensity: VisualDensity.compact,
            ),
          ),
        ],
      ),
    );
  }
}

class _ErrorHead extends StatelessWidget {
  const _ErrorHead({
    required this.message,
    required this.onRetry,
    required this.onBind,
  });

  final String message;
  final VoidCallback onRetry;
  final VoidCallback onBind;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;

    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 16, 20, 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.error_outline, size: 16, color: scheme.error),
              const SizedBox(width: 6),
              Text(
                '查不到',
                style: text.labelMedium?.copyWith(color: scheme.error),
              ),
              const Spacer(),
              TextButton(
                onPressed: onBind,
                style: TextButton.styleFrom(
                  visualDensity: VisualDensity.compact,
                  padding: const EdgeInsets.symmetric(horizontal: 8),
                ),
                child: const Text('重新绑定'),
              ),
            ],
          ),
          const Spacer(),
          Text(
            message,
            style: text.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
          ),
          const Spacer(),
          Align(
            alignment: Alignment.centerLeft,
            child: FilledButton.tonal(
              onPressed: onRetry,
              style: FilledButton.styleFrom(
                padding:
                    const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                visualDensity: VisualDensity.compact,
              ),
              child: const Text('重试'),
            ),
          ),
        ],
      ),
    );
  }
}

/// 列表里的一条成绩。
class _ScoreTile extends StatelessWidget {
  const _ScoreTile({required this.score});

  final SummaryScore score;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(10),
        child: Row(
          children: [
            ClipRRect(
              borderRadius: BorderRadius.circular(8),
              child: SizedBox(
                width: 48,
                height: 48,
                child: score.jacketUrl.isEmpty
                    ? ColoredBox(
                        color: scheme.surfaceContainerHighest,
                        child: Icon(Icons.music_note,
                            size: 20, color: scheme.onSurfaceVariant),
                      )
                    : Image.network(
                        score.jacketUrl,
                        fit: BoxFit.cover,
                        errorBuilder: (_, __, ___) => ColoredBox(
                          color: scheme.surfaceContainerHighest,
                          child: Icon(Icons.music_note,
                              size: 20, color: scheme.onSurfaceVariant),
                        ),
                      ),
              ),
            ),
            const SizedBox(width: 10),
            Container(
              width: 3,
              height: 36,
              decoration: BoxDecoration(
                color: DifficultyColors.of(score.levelIndex),
                borderRadius: BorderRadius.circular(2),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    score.title,
                    style: text.bodyMedium
                        ?.copyWith(fontWeight: FontWeight.w600),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  Text(
                    score.detail,
                    style: text.labelSmall
                        ?.copyWith(color: scheme.onSurfaceVariant),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 8),
            Text(
              score.value,
              style: text.titleMedium?.copyWith(
                fontWeight: FontWeight.w800,
                fontFeatures: const [FontFeature.tabularFigures()],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _EmptyList extends StatelessWidget {
  const _EmptyList({required this.summary});

  final GameSummary summary;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Text(
          summary.bound
              ? '这个游戏还没有成绩数据'
              : '绑定后这里会显示成绩',
          style: Theme.of(context)
              .textTheme
              .bodySmall
              ?.copyWith(color: scheme.onSurfaceVariant),
          textAlign: TextAlign.center,
        ),
      ),
    );
  }
}

IconData _iconOf(GameId game) => switch (game) {
      GameId.maimai => Icons.album,
      GameId.chunithm => Icons.piano,
      GameId.osu => Icons.sports_esports,
      GameId.phigros => Icons.music_note,
    };
