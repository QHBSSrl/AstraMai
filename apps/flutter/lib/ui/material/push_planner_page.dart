import 'package:flutter/material.dart';

import '../../core/models.dart';
import '../../core/rating.dart';
import '../theme.dart';

/// 推分计算器。
///
/// ── 解决什么问题 ────────────────────────────────────────────────────
///
/// 玩家看着 B50 想「这首再多打 2 分需要多少达成率」。
/// 手算要查系数表，很烦。
///
/// 这个页面：拖动目标 Rating，实时显示需要的达成率，以及**能不能达到**。
///
/// ── 三个数字都要显示 ────────────────────────────────────────────────
///
///   当前     100.5%  →  298
///   目标                 305
///   需要     101.2%        ← 如果超过 100.5 就是「打不到」
///
/// **只显示「还差 7 分」是废话** —— 用户不知道 7 分意味着什么。
/// 要换算成达成率，因为达成率是他能在游戏里看到的。
class PushPlannerPage extends StatefulWidget {
  const PushPlannerPage({super.key, required this.score});

  final MaimaiScore score;

  @override
  State<PushPlannerPage> createState() => _PushPlannerPageState();
}

class _PushPlannerPageState extends State<PushPlannerPage> {
  late int _target;

  @override
  void initState() {
    super.initState();
    _target = widget.score.rating ?? 0;
  }

  @override
  Widget build(BuildContext context) {


    final score = widget.score;

    final levelValue = score.levelValue;
    final current = score.rating ?? 0;
    final maxPossible = levelValue == null ? null : maxRatingForLevel(levelValue);

    // 目标能到多少
    final reachable = maxPossible == null || _target <= maxPossible;

    // 需要的达成率
    final needed = levelValue == null
        ? null
        : requiredAchievement(
            targetRating: _target,
            levelValue: levelValue,
            allPerfect: isAllPerfect(score.fc),
          );

    return Scaffold(
      appBar: AppBar(
        title: const Text('推分'),
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          _buildHeader(context),
          const SizedBox(height: 24),
          _buildTargetCard(context, current, maxPossible, reachable),
          const SizedBox(height: 16),
          _buildResultCard(context, needed, reachable),
          if (!reachable) ...[
            const SizedBox(height: 16),
            _buildUnreachableHint(context, maxPossible),
          ],
          const SizedBox(height: 24),
          _buildNote(context),
        ],
      ),
    );
  }

  Widget _buildHeader(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;
    final score = widget.score;

    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        ClipRRect(
          borderRadius: BorderRadius.circular(12),
          child: SizedBox(
            width: 64,
            height: 64,
            child: score.jacketUrl.isEmpty
                ? ColoredBox(
                    color: scheme.surfaceContainerHighest,
                    child: Icon(Icons.music_note, color: scheme.onSurfaceVariant),
                  )
                : Image.network(
                    score.jacketUrl,
                    fit: BoxFit.cover,
                    errorBuilder: (_, __, ___) => ColoredBox(
                      color: scheme.surfaceContainerHighest,
                      child: Icon(
                        Icons.music_note,
                        color: scheme.onSurfaceVariant,
                      ),
                    ),
                  ),
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                score.title,
                style: text.titleMedium?.copyWith(fontWeight: FontWeight.w700),
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
              const SizedBox(height: 4),
              Row(
                children: [
                  Text(
                    score.difficultyShort,
                    style: text.labelSmall?.copyWith(
                      color: score.levelIndex >= 3
                          ? const Color(0xFFA855F7)
                          : scheme.primary,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(width: 6),
                  Text(
                    score.level,
                    style: text.labelSmall?.copyWith(
                      color: scheme.onSurfaceVariant,
                    ),
                  ),
                  if (score.levelValue != null) ...[
                    const SizedBox(width: 4),
                    Text(
                      '(${score.levelValue})',
                      style: text.labelSmall?.copyWith(
                        color: scheme.onSurfaceVariant,
                      ),
                    ),
                  ],
                ],
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildTargetCard(
    BuildContext context,
    int current,
    int? maxPossible,
    bool reachable,
  ) {
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;

    // 滑条范围：当前 -20 到 maxPossible（如果已知），否则当前 +50
    final lo = (current - 20).clamp(0, 9999);
    final hi = maxPossible ?? (current + 50);

    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerLow,
        borderRadius: BorderRadius.circular(24),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            '目标 Rating',
            style: text.labelMedium?.copyWith(color: scheme.onSurfaceVariant),
          ),
          const SizedBox(height: 4),
          Text(
            '$_target',
            style: text.displayMedium?.copyWith(
              fontWeight: FontWeight.w800,
              letterSpacing: -1.5,
              fontFeatures: const [FontFeature.tabularFigures()],
              color: reachable ? null : scheme.error,
            ),
          ),
          const SizedBox(height: 8),
          Slider(
            value: _target.toDouble().clamp(lo.toDouble(), hi.toDouble()),
            min: lo.toDouble(),
            max: hi.toDouble(),
            divisions: (hi - lo).clamp(1, 100),
            label: '$_target',
            onChanged: (v) => setState(() => _target = v.round()),
          ),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                '当前 $current',
                style:
                    text.labelSmall?.copyWith(color: scheme.onSurfaceVariant),
              ),
              if (maxPossible != null)
                Text(
                  '打满 $maxPossible',
                  style:
                      text.labelSmall?.copyWith(color: scheme.onSurfaceVariant),
                ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              _StepButton(label: '-5', onTap: () => _bump(-5)),
              const SizedBox(width: 8),
              _StepButton(label: '-1', onTap: () => _bump(-1)),
              const SizedBox(width: 8),
              _StepButton(label: '+1', onTap: () => _bump(1)),
              const SizedBox(width: 8),
              _StepButton(label: '+5', onTap: () => _bump(5)),
            ],
          ),
        ],
      ),
    );
  }

  void _bump(int delta) {
    setState(() {
      _target = (_target + delta).clamp(0, 9999);
    });
  }

  Widget _buildResultCard(BuildContext context, double? needed, bool reachable) {
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;
    final score = widget.score;

    if (needed == null || !reachable) {
      return Container(
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(
          color: scheme.errorContainer,
          borderRadius: BorderRadius.circular(24),
        ),
        child: Row(
          children: [
            Icon(Icons.block, color: scheme.onErrorContainer),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                '这个目标打不到',
                style: text.titleMedium?.copyWith(
                  color: scheme.onErrorContainer,
                  fontWeight: FontWeight.w700,
                ),
              ),
            ),
          ],
        ),
      );
    }

    final currentPercent = score.achievements;
    final delta = needed - currentPercent;

    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerLow,
        borderRadius: BorderRadius.circular(24),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            '需要打到',
            style: text.labelMedium?.copyWith(color: scheme.onSurfaceVariant),
          ),
          const SizedBox(height: 4),
          Row(
            crossAxisAlignment: CrossAxisAlignment.baseline,
            textBaseline: TextBaseline.alphabetic,
            children: [
              Text(
                needed.toStringAsFixed(2),
                style: text.displaySmall?.copyWith(
                  fontWeight: FontWeight.w800,
                  letterSpacing: -1,
                  fontFeatures: const [FontFeature.tabularFigures()],
                  color: RateColors.of(rateFromAchievement(needed)),
                ),
              ),
              Text(
                '%',
                style: text.titleMedium?.copyWith(
                  color: scheme.onSurfaceVariant,
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            delta <= 0
                ? '已经够了（当前 ${currentPercent.toStringAsFixed(4)}%）'
                : delta < 0.0001
                    ? '刚好到达（当前 ${currentPercent.toStringAsFixed(4)}%）'
                    : '比现在多 ${delta.toStringAsFixed(2)}%',
            style: text.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
          ),
          if (needed > achievementCap) ...[
            const SizedBox(height: 12),
            Text(
              '⚠️ 超过 $achievementCap%，游戏里打不到',
              style: text.bodySmall?.copyWith(color: scheme.error),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildUnreachableHint(BuildContext context, int maxPossible) {
    final scheme = Theme.of(context).colorScheme;
    final text = Theme.of(context).textTheme;

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: scheme.surfaceContainerHigh,
        borderRadius: BorderRadius.circular(16),
      ),
      child: Row(
        children: [
          Icon(Icons.info_outline, size: 18, color: scheme.onSurfaceVariant),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              '这首打满最多 $maxPossible，想再高得换一首或者打别的谱面',
              style: text.bodySmall?.copyWith(color: scheme.onSurfaceVariant),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildNote(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return Text(
      'AP（All Perfect）有 +1 的 Rating 加成，'
      '所以 AP 的目标达成率会低一点点。',
      style: Theme.of(context)
          .textTheme
          .labelSmall
          ?.copyWith(color: scheme.outline),
    );
  }
}

class _StepButton extends StatelessWidget {
  const _StepButton({required this.label, required this.onTap});

  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Expanded(
      child: OutlinedButton(
        onPressed: onTap,
        style: OutlinedButton.styleFrom(
          visualDensity: VisualDensity.compact,
          padding: const EdgeInsets.symmetric(vertical: 8),
        ),
        child: Text(label),
      ),
    );
  }
}
