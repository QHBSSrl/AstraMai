import 'package:flutter/material.dart';

import '../../data/profile_store.dart';
import '../../features/home/home_controller.dart';

/// 首页 Tab。
///
/// ── 这一版的设计 ────────────────────────────────────────────────────
///
///   ┌─────────────────────────┐
///   │ AstraMai            ⟳   │
///   │ ┌─────────────────────┐ │
///   │ │ 舞萌 DX        [銅]  │ │
///   │ │ QBHSSrl             │ │
///   │ │  12038  DX Rating   │ │  ← head 卡片
///   │ │ 8396旧曲 3642新曲    │ │
///   │ │              ● ○ ○ ○│ │  ← 指示器在卡片右下角
///   │ └─────────────────────┘ │
///   │                         │
///   │  快捷                    │
///   │  ┌────────┐ ┌────────┐  │
///   │  │ 查分    │ │ 推分   │  │
///   │  └────────┘ └────────┘  │
///   │  ┌────────┐ ┌────────┐  │
///   │  │ 对比    │ │ 二维码 │  │
///   │  └────────┘ └────────┘  │
///   │                         │
///   │  最近                    │
///   │  · 上周还在 11,900       │
///   └─────────────────────────┘
///
/// ── 为什么首页不放 B50 ──────────────────────────────────────────────
///
/// B50 是**明细**，首页是**概览**。
///
/// 把 50 条成绩堆在首页，等于把"我最近分数变了没有"这个问题的答案
/// 埋在 50 行数据里。想看明细点「查分」进去，首页只回答
/// 「我现在什么水平、有什么可以做的」。
class HomeTab extends StatefulWidget {
  const HomeTab({super.key});

  @override
  State<HomeTab> createState() => _HomeTabState();
}

class _HomeTabState extends State<HomeTab> {
  final _controller = HomeController();
  final _pageController = PageController();

  static const double _headHeight = 196;

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
            child: ListView(
              padding: const EdgeInsets.only(bottom: 24),
              children: [
                _buildHeader(context),
                SizedBox(
                  height: _headHeight,
                  child: PageView.builder(
                    controller: _pageController,
                    itemCount: _controller.games.length,
                    onPageChanged: _controller.select,
                    itemBuilder: (context, index) {
                      final game = _controller.games[index];
                      return _HeadCard(
                        summary: _controller.summaryOf(game),
                        index: index,
                        total: _controller.games.length,
                        current: _controller.index,
                        onBind: () => _showBindSheet(game),
                        onRetry: () => _controller.refresh(game),
                      );
                    },
                  ),
                ),
                const SizedBox(height: 20),
                _buildQuickActions(context),
                const SizedBox(height: 24),
                _buildFooter(context),
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
            tooltip: '刷新',
          ),
        ],
      ),
    );
  }

  /// 快捷功能。
  ///
  /// ⚠️ 现在点进去都没反应 —— 功能还没做。
  /// 但**先放出来**是因为要确认这个网格的密度和位置对不对。
  Widget _buildQuickActions(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;

    final actions = <(IconData, String, String)>[
      (Icons.leaderboard, '查分', 'B50 / B30 明细'),
      (Icons.trending_up, '推分', '算要打到多少'),
      (Icons.compare_arrows, '对比', '这周涨了多少'),
      (Icons.qr_code_2, '二维码', '机台扫码登录'),
    ];

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(4, 0, 0, 10),
            child: Text(
              '快捷',
              style: text.titleSmall?.copyWith(
                color: scheme.onSurfaceVariant,
                letterSpacing: 1,
                fontWeight: FontWeight.w700,
              ),
            ),
          ),
          GridView.count(
            crossAxisCount: 2,
            shrinkWrap: true,
            physics: const NeverScrollableScrollPhysics(),
            mainAxisSpacing: 10,
            crossAxisSpacing: 10,
            childAspectRatio: 2.3,
            children: [
              for (final (icon, title, subtitle) in actions)
                Card(
                  child: InkWell(
                    borderRadius: BorderRadius.circular(16),
                    onTap: () => _showComingSoon(title),
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(16, 12, 12, 12),
                      child: Row(
                        children: [
                          Icon(icon, size: 22, color: scheme.primary),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              mainAxisAlignment: MainAxisAlignment.center,
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  title,
                                  style: text.titleSmall?.copyWith(
                                    fontWeight: FontWeight.w700,
                                  ),
                                ),
                                Text(
                                  subtitle,
                                  style: text.labelSmall?.copyWith(
                                    color: scheme.onSurfaceVariant,
                                  ),
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ],
      ),
    );
  }

  /// 页脚 —— 现在只放一句版本号。
  ///
  /// 留这个位置是因为以后要放「距下一档还差多少」之类的提示。
  Widget _buildFooter(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 24),
      child: Text(
        'AstraMai · 0.1.0',
        style: Theme.of(context)
            .textTheme
            .labelSmall
            ?.copyWith(color: scheme.outline),
        textAlign: TextAlign.center,
      ),
    );
  }

  void _showComingSoon(String what) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('「$what」还没做'),
        behavior: SnackBarBehavior.floating,
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

/// head 卡片。
class _HeadCard extends StatelessWidget {
  const _HeadCard({
    required this.summary,
    required this.index,
    required this.total,
    required this.current,
    required this.onBind,
    required this.onRetry,
  });

  final GameSummary summary;
  final int index;
  final int total;
  final int current;
  final VoidCallback onBind;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 0),
      child: Container(
        decoration: BoxDecoration(
          color: scheme.surfaceContainerLow,
          borderRadius: BorderRadius.circular(24),
        ),
        clipBehavior: Clip.antiAlias,
        child: Stack(
          children: [
            Positioned.fill(
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
            // 指示器 —— 卡片右下角，不占额外高度
            Positioned(
              right: 16,
              bottom: 12,
              child: _Indicator(index: index, total: total, current: current),
            ),
          ],
        ),
      ),
    );
  }
}

/// 卡片右下角的页码指示器。
///
/// ⚠️ 放在卡片**内部**而不是下面 —— 放下面会多占一行高度，
/// 而且跟着卡片滑动的视觉关系也断了。
class _Indicator extends StatelessWidget {
  const _Indicator({
    required this.index,
    required this.total,
    required this.current,
  });

  final int index;
  final int total;
  final int current;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final isActive = index == current;

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        for (var i = 0; i < total; i++)
          AnimatedContainer(
            duration: const Duration(milliseconds: 220),
            margin: const EdgeInsets.only(left: 4),
            width: i == current ? 14 : 5,
            height: 5,
            decoration: BoxDecoration(
              // 在浅色卡片上要用 outline 而不是 outlineVariant，
              // 后者太淡了看不见
              color: i == current
                  ? scheme.primary
                  : scheme.outline.withValues(alpha: isActive ? 0.45 : 0.25),
              borderRadius: BorderRadius.circular(3),
            ),
          ),
      ],
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
      // 右边留 88 给指示器，别让文字压上去
      padding: const EdgeInsets.fromLTRB(20, 16, 88, 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Row(
            children: [
              Icon(_iconOf(summary.game), size: 16, color: scheme.primary),
              const SizedBox(width: 6),
              Flexible(
                child: Text(
                  summary.game.label,
                  style: text.labelMedium?.copyWith(color: scheme.primary),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              const SizedBox(width: 8),
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
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
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
                      style: text.labelSmall
                          ?.copyWith(color: scheme.onSurfaceVariant),
                    ),
                  ),
                ],
              ),
            ],
          ),
          if (summary.extras.isNotEmpty)
            Row(
              children: [
                for (var i = 0; i < summary.extras.length; i++) ...[
                  if (i > 0) const SizedBox(width: 16),
                  Flexible(
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          summary.extras[i].$2,
                          style: text.labelMedium?.copyWith(
                            fontWeight: FontWeight.w700,
                            fontFeatures: const [FontFeature.tabularFigures()],
                          ),
                          overflow: TextOverflow.ellipsis,
                        ),
                        const SizedBox(width: 4),
                        Text(
                          summary.extras[i].$1,
                          style: text.labelSmall
                              ?.copyWith(color: scheme.onSurfaceVariant),
                          overflow: TextOverflow.ellipsis,
                        ),
                      ],
                    ),
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
      padding: const EdgeInsets.fromLTRB(20, 16, 88, 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(_iconOf(game), size: 16, color: scheme.onSurfaceVariant),
              const SizedBox(width: 6),
              Text(
                game.label,
                style:
                    text.labelMedium?.copyWith(color: scheme.onSurfaceVariant),
              ),
            ],
          ),
          const Spacer(),
          Text(
            '还没绑定${game.bindingLabel}',
            style: text.bodyMedium?.copyWith(color: scheme.onSurfaceVariant),
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
      padding: const EdgeInsets.fromLTRB(20, 16, 88, 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(_iconOf(game), size: 16, color: scheme.onSurfaceVariant),
              const SizedBox(width: 6),
              Text(
                game.label,
                style:
                    text.labelMedium?.copyWith(color: scheme.onSurfaceVariant),
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
      padding: const EdgeInsets.fromLTRB(20, 16, 88, 16),
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

IconData _iconOf(GameId game) => switch (game) {
      GameId.maimai => Icons.album,
      GameId.chunithm => Icons.piano,
      GameId.osu => Icons.sports_esports,
      GameId.phigros => Icons.music_note,
    };
