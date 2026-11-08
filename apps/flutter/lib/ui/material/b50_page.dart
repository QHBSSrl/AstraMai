import 'package:flutter/material.dart';

import '../../core/models.dart';
import '../../features/b50/b50_controller.dart';
import '../theme.dart';

/// B50 页（Material 3 实现）。
///
/// ── 这个文件的位置很关键 ────────────────────────────────────────────
///
/// 它在 `ui/material/` 下，不是 `ui/` 下。
///
/// 因为用户说了「iOS 塞个 MD3 太违和，每个平台用自己平台的原生 UI」。
/// 所以目录结构要提前分好：
///
///   ui/material/b50_page.dart    ← Android（现在这个）
///   ui/cupertino/b50_page.dart   ← iOS（以后）
///   ui/ohos/b50_page.dart        ← 鸿蒙（以后）
///
/// 三份 UI 共用 `features/b50/b50_controller.dart` 里的逻辑。
///
/// ⚠️ **不要在 features/ 里 import 任何 UI 包。**
class B50Page extends StatefulWidget {
  const B50Page({super.key});

  @override
  State<B50Page> createState() => _B50PageState();
}

class _B50PageState extends State<B50Page> {
  final _controller = B50Controller();
  final _input = TextEditingController();

  @override
  void dispose() {
    _controller.dispose();
    _input.dispose();
    super.dispose();
  }

  void _search() {
    final raw = _input.text.trim();
    if (raw.isEmpty) return;

    FocusScope.of(context).unfocus();

    // 纯数字且够长 → 好友码；否则当 QQ 号
    final asInt = int.tryParse(raw);
    if (asInt != null && raw.length >= 10) {
      _controller.loadByFriendCode(asInt);
    } else {
      _controller.loadByQq(raw);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, _) {
        final view = _controller.view;
        final scheme = Theme.of(context).colorScheme;

        return Scaffold(
          body: RefreshIndicator(
            onRefresh: () async {
              final code = _controller.lastFriendCode;
              if (code != null) await _controller.loadByFriendCode(code);
            },
            child: CustomScrollView(
              slivers: [
                _buildAppBar(context),
                if (_controller.error != null)
                  SliverToBoxAdapter(
                    child: _ErrorBanner(
                      message: _controller.error!,
                      onDismiss: _controller.clearError,
                    ),
                  ),
                if (view == null && !_controller.loading)
                  const SliverFillRemaining(
                    hasScrollBody: false,
                    child: _EmptyState(),
                  )
                else if (view != null) ...[
                  SliverToBoxAdapter(child: _buildPlayerCard(context, view)),
                  SliverToBoxAdapter(child: _buildSortBar(context)),
                  SliverList.builder(
                    itemCount: _controller.scores.length,
                    itemBuilder: (context, index) {
                      final score = _controller.scores[index];
                      return Padding(
                        padding: EdgeInsets.fromLTRB(
                          16,
                          index == 0 ? 8 : 4,
                          16,
                          index == _controller.scores.length - 1 ? 24 : 4,
                        ),
                        child: _ScoreCard(score: score, rank: index + 1),
                      );
                    },
                  ),
                ],
                if (_controller.loading)
                  const SliverFillRemaining(
                    hasScrollBody: false,
                    child: Center(child: CircularProgressIndicator()),
                  ),
              ],
            ),
          ),
          backgroundColor: scheme.surface,
        );
      },
    );
  }

  Widget _buildAppBar(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return SliverAppBar(
      floating: true,
      snap: true,
      backgroundColor: scheme.surface,
      surfaceTintColor: Colors.transparent,
      title: TextField(
        controller: _input,
        keyboardType: TextInputType.text,
        textInputAction: TextInputAction.search,
        onSubmitted: (_) => _search(),
        decoration: InputDecoration(
          hintText: '好友码或 QQ 号',
          isDense: true,
          filled: true,
          fillColor: scheme.surfaceContainerHigh,
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(999),
            borderSide: BorderSide.none,
          ),
          contentPadding:
              const EdgeInsets.symmetric(horizontal: 20, vertical: 12),
        ),
      ),
      actions: [
        IconButton(
          onPressed: _search,
          icon: const Icon(Icons.search),
          tooltip: '查询',
        ),
      ],
    );
  }

  /// 玩家名片。
  ///
  /// 这是首屏最重要的东西 —— 玩家打开 App 90% 是想看这个数字变了没有。
  Widget _buildPlayerCard(BuildContext context, MaimaiB50View view) {
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;
    final player = view.player;

    final tierColor = player.tier == null
        ? scheme.onSurfaceVariant
        : _hexColor(player.tier!.color) ?? scheme.primary;

    return Container(
      margin: const EdgeInsets.fromLTRB(16, 8, 16, 8),
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerLow,
        borderRadius: BorderRadius.circular(24),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              CircleAvatar(
                radius: 22,
                backgroundColor: scheme.secondaryContainer,
                child: Text(
                  player.name.isEmpty ? '?' : player.name.characters.first,
                  style: text.titleMedium?.copyWith(
                    color: scheme.onSecondaryContainer,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      player.name.isEmpty ? '未知玩家' : player.name,
                      style: text.titleMedium?.copyWith(
                        fontWeight: FontWeight.w700,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    if (player.friendCode != 0)
                      Text(
                        '${player.friendCode}',
                        style: text.bodySmall?.copyWith(
                          color: scheme.onSurfaceVariant,
                          fontFeatures: const [FontFeature.tabularFigures()],
                        ),
                      ),
                  ],
                ),
              ),
              if (player.tier != null)
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                  decoration: BoxDecoration(
                    color: tierColor.withValues(alpha: 0.16),
                    borderRadius: BorderRadius.circular(999),
                  ),
                  child: Text(
                    player.tier!.label,
                    style: text.labelMedium?.copyWith(
                      color: tierColor,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
            ],
          ),
          const SizedBox(height: 20),
          // 巨大的 Rating —— 这个数字是这个 App 的主角
          Text(
            '${player.rating}',
            style: text.displayMedium?.copyWith(
              fontWeight: FontWeight.w700,
              fontFeatures: const [FontFeature.tabularFigures()],
              letterSpacing: -1,
            ),
          ),
          Text(
            'DX Rating',
            style: text.labelSmall?.copyWith(color: scheme.onSurfaceVariant),
          ),
          const SizedBox(height: 16),
          Row(
            children: [
              _MiniStat(label: '旧曲', value: '${view.stats.standardTotal}'),
              const SizedBox(width: 24),
              _MiniStat(label: '新曲', value: '${view.stats.dxTotal}'),
              const SizedBox(width: 24),
              _MiniStat(
                label: '平均定数',
                value: view.stats.averageLevelValue.toStringAsFixed(2),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildSortBar(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return Padding(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 0),
      child: Row(
        children: [
          Text(
            'B50',
            style: Theme.of(context).textTheme.titleSmall?.copyWith(
                  color: scheme.onSurfaceVariant,
                  letterSpacing: 1,
                ),
          ),
          const Spacer(),
          TextButton.icon(
            onPressed: _controller.toggleSort,
            icon: const Icon(Icons.swap_vert, size: 18),
            label: Text(_controller.sortByRating ? '按 Rating' : '按定数'),
          ),
        ],
      ),
    );
  }

  static Color? _hexColor(String hex) {
    final clean = hex.replaceAll('#', '');
    if (clean.length != 6) return null;
    final value = int.tryParse(clean, radix: 16);
    if (value == null) return null;
    return Color(0xFF000000 | value);
  }
}

class _ScoreCard extends StatelessWidget {
  const _ScoreCard({required this.score, required this.rank});

  final MaimaiScore score;
  final int rank;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;
    final difficultyColor = DifficultyColors.of(score.levelIndex);
    final rateColor = RateColors.of(score.rate);

    return Card(
      child: InkWell(
        borderRadius: BorderRadius.circular(16),
        onTap: () {
          // TODO: 进详情 / 推分
        },
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Row(
            children: [
              // 封面。加载失败时显示一个占位（很多曲绘 URL 会 404）
              ClipRRect(
                borderRadius: BorderRadius.circular(10),
                child: SizedBox(
                  width: 56,
                  height: 56,
                  child: score.jacketUrl.isEmpty
                      ? ColoredBox(
                          color: scheme.surfaceContainerHighest,
                          child: Icon(
                            Icons.music_note,
                            size: 24,
                            color: scheme.onSurfaceVariant,
                          ),
                        )
                      : Image.network(
                          score.jacketUrl,
                          fit: BoxFit.cover,
                          errorBuilder: (_, __, ___) => ColoredBox(
                            color: scheme.surfaceContainerHighest,
                            child: Icon(
                              Icons.music_note,
                              size: 24,
                              color: scheme.onSurfaceVariant,
                            ),
                          ),
                        ),
                ),
              ),
              const SizedBox(width: 12),
              // 难度竖条 —— 只在左边缘 3px，不整张卡染色
              Container(
                width: 3,
                height: 44,
                decoration: BoxDecoration(
                  color: difficultyColor,
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
                      style: text.bodyMedium?.copyWith(
                        fontWeight: FontWeight.w600,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 2),
                    Row(
                      children: [
                        Text(
                          score.difficultyShort,
                          style: text.labelSmall?.copyWith(
                            color: difficultyColor,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        const SizedBox(width: 6),
                        Text(
                          score.level,
                          style: text.labelSmall?.copyWith(
                            color: scheme.onSurfaceVariant,
                            fontFeatures: const [
                              FontFeature.tabularFigures()
                            ],
                          ),
                        ),
                        if (score.fc.isNotEmpty) ...[
                          const SizedBox(width: 6),
                          Text(
                            score.fc.toUpperCase(),
                            style: text.labelSmall?.copyWith(
                              color: scheme.tertiary,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ],
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(
                    score.achievements.toStringAsFixed(4),
                    style: text.bodySmall?.copyWith(
                      color: rateColor,
                      fontWeight: FontWeight.w700,
                      fontFeatures: const [FontFeature.tabularFigures()],
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    score.rating == null ? '—' : '${score.rating}',
                    style: text.titleMedium?.copyWith(
                      fontWeight: FontWeight.w800,
                      fontFeatures: const [FontFeature.tabularFigures()],
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _MiniStat extends StatelessWidget {
  const _MiniStat({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final scheme = Theme.of(context).colorScheme;

    return Column(
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
          style: text.labelSmall?.copyWith(color: scheme.onSurfaceVariant),
        ),
      ],
    );
  }
}

class _ErrorBanner extends StatelessWidget {
  const _ErrorBanner({required this.message, required this.onDismiss});

  final String message;
  final VoidCallback onDismiss;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return Container(
      margin: const EdgeInsets.fromLTRB(16, 4, 16, 8),
      padding: const EdgeInsets.fromLTRB(16, 12, 8, 12),
      decoration: BoxDecoration(
        color: scheme.errorContainer,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: [
          Expanded(
            child: Text(
              message,
              style: TextStyle(color: scheme.onErrorContainer),
            ),
          ),
          IconButton(
            onPressed: onDismiss,
            icon: Icon(Icons.close, color: scheme.onErrorContainer, size: 18),
          ),
        ],
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  const _EmptyState();

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return Padding(
      padding: const EdgeInsets.all(32),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.leaderboard_outlined, size: 56, color: scheme.outline),
          const SizedBox(height: 16),
          Text(
            '输入好友码或 QQ 号',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 4),
          Text(
            '好友码在游戏内「玩家信息」里',
            style: Theme.of(context)
                .textTheme
                .bodySmall
                ?.copyWith(color: scheme.onSurfaceVariant),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }
}
