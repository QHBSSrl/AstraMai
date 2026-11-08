import 'package:flutter/material.dart';

import '../../data/profile_store.dart';
import '../../features/home/home_controller.dart';
import '../theme.dart';

/// 首页（Material 3 实现）。
///
/// ── 结构 ────────────────────────────────────────────────────────────
///
/// 上半是一个可左右滑动的卡片区（每个游戏一张），下半固定显示当前游戏
/// 的绑定信息或快捷入口。
///
///   ┌─────────────────────────┐
///   │  ← 滑动切换  →           │
///   │  ┌───────────────────┐   │
///   │  │ 舞萌 DX            │   │
///   │  │ QBHSSrl            │   │
///   │  │      15,023        │   │  ← 巨大数字
///   │  │      虹             │   │
///   │  │  旧曲 8396 新曲 3642 │   │
///   │  │  ─────────────     │   │
///   │  │  前三首成绩预览      │   │
///   │  └───────────────────┘   │
///   │      ● ○ ○ ○           │   │
///   └─────────────────────────┘
///
/// ── 为什么卡片要滑动而不是 Tab ──────────────────────────────────────
///
/// Tab 会让四个游戏"平等"，但玩家的实力分布从来不是平的 ——
/// 大多数人只认真玩一两个。滑动让"主游戏"能在第一页，
/// 其他游戏滑一下就到，不占视觉权重。
class HomePage extends StatefulWidget {
  const HomePage({super.key});

  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> {
  final _controller = HomeController();
  final _pageController = PageController();

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

        return Scaffold(
          backgroundColor: scheme.surface,
          body: SafeArea(
            bottom: false,
            child: Column(
              children: [
                _buildHeader(context),
                Expanded(
                  child: PageView.builder(
                    controller: _pageController,
                    itemCount: _controller.games.length,
                    onPageChanged: _controller.select,
                    itemBuilder: (context, index) {
                      final game = _controller.games[index];
                      return _GameCard(
                        summary: _controller.summaryOf(game),
                        onBind: () => _showBindSheet(game),
                        onRefresh: () => _controller.refresh(game),
                      );
                    },
                  ),
                ),
                _buildIndicator(context),
                const SizedBox(height: 16),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _buildHeader(BuildContext context) {

    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 8, 12, 4),
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

  /// 页码指示器。
  ///
  /// 用拉长的胶囊而不是圆点 —— 圆点在四个的时候还行，以后加到六个
  /// 就分不清了。
  Widget _buildIndicator(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return Row(
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
    );
  }

  /// 绑定弹窗。
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

/// 一张游戏卡片。
class _GameCard extends StatelessWidget {
  const _GameCard({
    required this.summary,
    required this.onBind,
    required this.onRefresh,
  });

  final GameSummary summary;
  final VoidCallback onBind;
  final VoidCallback onRefresh;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
      child: Container(
        decoration: BoxDecoration(
          color: scheme.surfaceContainerLow,
          borderRadius: BorderRadius.circular(28),
        ),
        clipBehavior: Clip.antiAlias,
        child: summary.loading
            ? const Center(child: CircularProgressIndicator())
            : summary.error != null
                ? _ErrorContent(
                    game: summary.game,
                    message: summary.error!,
                    onRetry: onRefresh,
                    onBind: onBind,
                  )
                : !summary.bound
                    ? _UnboundContent(game: summary.game, onBind: onBind)
                    : summary.needsLogin
                        ? _LoginContent(game: summary.game, onBind: onBind)
                        : _BoundContent(summary: summary, onRefresh: onRefresh),
      ),
    );
  }
}

/// 已绑定 —— 正常展示。
class _BoundContent extends StatelessWidget {
  const _BoundContent({required this.summary, required this.onRefresh});

  final GameSummary summary;
  final VoidCallback onRefresh;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;

    final tierColor = summary.tierColor == null
        ? scheme.primary
        : _hex(summary.tierColor!) ?? scheme.primary;

    return SingleChildScrollView(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(_iconOf(summary.game), size: 18, color: scheme.primary),
              const SizedBox(width: 8),
              Text(
                summary.game.label,
                style: text.labelLarge?.copyWith(color: scheme.primary),
              ),
              const Spacer(),
              if (summary.tierLabel != null)
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 10, vertical: 3),
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
          const SizedBox(height: 20),
          Text(
            summary.playerName,
            style: text.titleMedium?.copyWith(
              color: scheme.onSurfaceVariant,
              fontWeight: FontWeight.w600,
            ),
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
          const SizedBox(height: 4),
          // 主角：大数字
          Row(
            crossAxisAlignment: CrossAxisAlignment.baseline,
            textBaseline: TextBaseline.alphabetic,
            children: [
              Text(
                summary.primaryValue,
                style: text.displayLarge?.copyWith(
                  fontWeight: FontWeight.w800,
                  letterSpacing: -2,
                  fontFeatures: const [FontFeature.tabularFigures()],
                ),
              ),
              const SizedBox(width: 8),
              Padding(
                padding: const EdgeInsets.only(bottom: 10),
                child: Text(
                  summary.game.primaryLabel,
                  style: text.labelSmall?.copyWith(
                    color: scheme.onSurfaceVariant,
                  ),
                ),
              ),
            ],
          ),
          if (summary.extras.isNotEmpty) ...[
            const SizedBox(height: 8),
            Wrap(
              spacing: 20,
              runSpacing: 8,
              children: [
                for (final (label, value) in summary.extras)
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        value,
                        style: text.titleSmall?.copyWith(
                          fontWeight: FontWeight.w700,
                          fontFeatures: const [FontFeature.tabularFigures()],
                        ),
                      ),
                      Text(
                        label,
                        style: text.labelSmall
                            ?.copyWith(color: scheme.onSurfaceVariant),
                      ),
                    ],
                  ),
              ],
            ),
          ],
          if (summary.topScores.isNotEmpty) ...[
            const SizedBox(height: 24),
            Text(
              '最近的好成绩',
              style: text.labelSmall?.copyWith(
                color: scheme.onSurfaceVariant,
                letterSpacing: 0.5,
              ),
            ),
            const SizedBox(height: 10),
            for (final score in summary.topScores)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Row(
                  children: [
                    Container(
                      width: 3,
                      height: 28,
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
                            style: text.bodySmall?.copyWith(
                              fontWeight: FontWeight.w600,
                            ),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                          Text(
                            score.detail,
                            style: text.labelSmall?.copyWith(
                              color: scheme.onSurfaceVariant,
                            ),
                          ),
                        ],
                      ),
                    ),
                    Text(
                      score.value,
                      style: text.titleSmall?.copyWith(
                        fontWeight: FontWeight.w700,
                        fontFeatures: const [FontFeature.tabularFigures()],
                      ),
                    ),
                  ],
                ),
              ),
          ],
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

/// 没绑定。
class _UnboundContent extends StatelessWidget {
  const _UnboundContent({required this.game, required this.onBind});

  final GameId game;
  final VoidCallback onBind;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;

    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(_iconOf(game), size: 48, color: scheme.outline),
            const SizedBox(height: 16),
            Text(game.label, style: text.titleLarge),
            const SizedBox(height: 6),
            Text(
              '还没绑定${game.bindingLabel}',
              style: text.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 20),
            FilledButton.icon(
              onPressed: onBind,
              icon: const Icon(Icons.link, size: 18),
              label: Text('绑定${game.bindingLabel}'),
            ),
          ],
        ),
      ),
    );
  }
}

/// Phigros 要登录。
class _LoginContent extends StatelessWidget {
  const _LoginContent({required this.game, required this.onBind});

  final GameId game;
  final VoidCallback onBind;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;

    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(_iconOf(game), size: 48, color: scheme.outline),
            const SizedBox(height: 16),
            Text(game.label, style: text.titleLarge),
            const SizedBox(height: 6),
            Text(
              'Phigros 需要扫码登录 TapTap 才能查成绩\n（不像另外三个能直接查）',
              style: text.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 20),
            FilledButton.icon(
              onPressed: onBind,
              icon: const Icon(Icons.qr_code, size: 18),
              label: const Text('登录'),
            ),
          ],
        ),
      ),
    );
  }
}

/// 出错。
class _ErrorContent extends StatelessWidget {
  const _ErrorContent({
    required this.game,
    required this.message,
    required this.onRetry,
    required this.onBind,
  });

  final GameId game;
  final String message;
  final VoidCallback onRetry;
  final VoidCallback onBind;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;

    return Center(
      child: Padding(
        padding: const EdgeInsets.all(28),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.error_outline, size: 40, color: scheme.error),
            const SizedBox(height: 14),
            Text(
              message,
              style: text.bodySmall,
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 20),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                TextButton(onPressed: onBind, child: const Text('重新绑定')),
                const SizedBox(width: 8),
                FilledButton.tonal(
                  onPressed: onRetry,
                  child: const Text('重试'),
                ),
              ],
            ),
          ],
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
