/// DX Rating 计算。
///
/// 移植自 `packages/core/src/maimai/rating.ts`。
///
/// ── 公式 ────────────────────────────────────────────────────────────
///
/// ```
/// 单曲 Rating = floor(定数 × (达成率 / 100) × ランク係数 + AP 加成)
/// ```
///
/// `ランク係数` 是按达成率查表（见 [dxRatingCoefficients]），
/// AP（All Perfect）额外 +1。
///
/// ⚠️ **同一档位里"顶格"的达成率单独列了一档。**
/// 比如 SSS 是 100.0 起，但 100.4999（SSS 但没到 SSS+）用的是 22.2 而不是 21.6。
/// 这是游戏的实际行为，不是笔误 —— 漏了这一档会让高分段全部少算 1 分。
library;

/// 达成率上限。超过 100.5 的只按 100.5 算（游戏内封顶）。
const double achievementCap = 100.5;

/// 数据源可能给的万分位阈值。
const double achievementMax = 101.0;

/// 一个档位。
class RatingCoefficientStep {
  const RatingCoefficientStep(this.minimum, this.coefficient, this.note);

  /// 达成率下限（含）。
  final double minimum;

  /// 系数。
  final double coefficient;

  /// 档位名，只用于调试和展示。
  final String note;
}

/// 系数表，**必须按 minimum 降序**。
///
/// 「同档顶格」的达成率写成 100.4999 这种值 —— 这是游戏内达成率的显示精度
/// 上限，也是实际能取到该系数的达成率。
const List<RatingCoefficientStep> dxRatingCoefficients = [
  RatingCoefficientStep(100.5, 22.4, 'SSS+'),
  RatingCoefficientStep(100.4999, 22.2, 'SSS 顶格'),
  RatingCoefficientStep(100.0, 21.6, 'SSS'),
  RatingCoefficientStep(99.9999, 21.4, 'SS+ 顶格'),
  RatingCoefficientStep(99.5, 21.1, 'SS+'),
  RatingCoefficientStep(99.0, 20.8, 'SS'),
  RatingCoefficientStep(98.9999, 20.6, 'S+ 顶格'),
  RatingCoefficientStep(98.0, 20.3, 'S+'),
  RatingCoefficientStep(97.0, 20.0, 'S'),
  RatingCoefficientStep(96.9999, 17.6, 'AAA 顶格'),
  RatingCoefficientStep(94.0, 16.8, 'AAA'),
  RatingCoefficientStep(90.0, 15.2, 'AA'),
  RatingCoefficientStep(80.0, 13.6, 'A'),
  RatingCoefficientStep(79.9999, 12.8, 'BBB 顶格'),
  RatingCoefficientStep(75.0, 12.0, 'BBB'),
  RatingCoefficientStep(70.0, 11.2, 'BB'),
  RatingCoefficientStep(60.0, 9.6, 'B'),
  RatingCoefficientStep(50.0, 8.0, 'C'),
  RatingCoefficientStep(40.0, 6.4, 'D'),
  RatingCoefficientStep(30.0, 4.8, 'D'),
  RatingCoefficientStep(20.0, 3.2, 'D'),
  RatingCoefficientStep(10.0, 1.6, 'D'),
  RatingCoefficientStep(0.0, 0.0, '低于 10% 不计分'),
];

/// 归一化达成率。
///
/// 落雪用百分数（`100.5`），有些源用万分位（`1005000`）。
/// 统一折算成百分数并夹在 [0, 101]。
double normalizeAchievement(double achievement) {
  if (!achievement.isFinite) return 0;

  // 百分数：0 ~ 101，直接用
  if (achievement <= achievementMax) {
    return achievement.clamp(0.0, achievementMax);
  }

  /*
   * 超过 101 的可能是万分位（1005000 = 100.5），也可能是脏数据（200）。
   *
   * ⚠️ 不能一刀切除以 10000 —— 200 / 10000 = 0.02，会被当成 0.02%，
   * 然后按「低于 10% 不计分」算成 0 分。那首本来满分的歌会变成 0。
   *
   * 判据：除以 10000 之后至少要有 1%，才认为它确实是万分位。
   * 否则（除以 10000 后还不到 1）就是脏数据，按封顶值处理。
   */
  final asTenThousandths = achievement / 10000;
  if (asTenThousandths >= 1) {
    return asTenThousandths.clamp(0.0, achievementMax);
  }

  return achievementMax;
}

/// 按达成率取系数。低于 10% 时是 0。
double dxRatingCoefficient(double achievement) {
  final percent = normalizeAchievement(achievement);
  for (final step in dxRatingCoefficients) {
    if (percent >= step.minimum) return step.coefficient;
  }
  return 0;
}

/// 这一达成率落在哪一档（调试 / 展示用）。
RatingCoefficientStep dxRatingCoefficientStep(double achievement) {
  final percent = normalizeAchievement(achievement);
  for (final step in dxRatingCoefficients) {
    if (percent >= step.minimum) return step;
  }
  return dxRatingCoefficients.last;
}

/// 算单曲 Rating。
///
/// `allPerfect` 为 true（或者 `fc` 是 `ap` / `app`）时 +1。
///
/// ⚠️ 用 `floor` 不是 `round` —— 游戏内是向下取整。
/// 用 `round` 会让大部分成绩多 1 分，然后**整体 Rating 对不上**。
int calculateDxRating({
  required double levelValue,
  required double achievement,
  bool allPerfect = false,
}) {
  final percent = normalizeAchievement(achievement).clamp(0.0, achievementCap);
  final coefficient = dxRatingCoefficient(percent);
  final base = levelValue * (percent / 100) * coefficient;
  final bonus = allPerfect ? 1 : 0;

  // 加 1e-9 抵消浮点误差（比如 14.2 * 0.985 * 21.4 可能算出 x.9999999）
  return (base + bonus + 1e-9).floor();
}

/// 这首谱打满能到多少 Rating。
int maxRatingForLevel(double levelValue) {
  return calculateDxRating(
    levelValue: levelValue,
    achievement: achievementCap,
    allPerfect: true,
  );
}

/// `fc` 字段是不是 All Perfect。
bool isAllPerfect(String? fc) {
  if (fc == null) return false;
  final lower = fc.toLowerCase();
  return lower == 'ap' || lower == 'app';
}

/// 达成率 → 评级（`sssp` / `sss` / …）。
String rateFromAchievement(double achievement) {
  final percent = normalizeAchievement(achievement);
  const thresholds = [
    (100.5, 'sssp'),
    (100.0, 'sss'),
    (99.5, 'ssp'),
    (99.0, 'ss'),
    (98.0, 'sp'),
    (97.0, 's'),
    (94.0, 'aaa'),
    (90.0, 'aa'),
    (80.0, 'a'),
    (75.0, 'bbb'),
    (70.0, 'bb'),
    (60.0, 'b'),
    (50.0, 'c'),
    (0.0, 'd'),
  ];

  for (final (minimum, rate) in thresholds) {
    if (percent >= minimum) return rate;
  }
  return 'd';
}

/// 反推：想达到 `targetRating`，在 `levelValue` 上需要多少达成率。
///
/// 推分计算器的核心。
///
/// 返回 `null` 表示**打满也达不到** —— 这时候界面上要说「这首不够高」，
/// 而不是给一个 101% 这种打不到的目标。
double? requiredAchievement({
  required int targetRating,
  required double levelValue,
  bool allPerfect = false,
}) {
  if (levelValue <= 0) return null;

  final bonus = allPerfect ? 1 : 0;

  // 从高到低扫系数表，找第一个能达成的档位
  for (final step in dxRatingCoefficients) {
    if (step.coefficient <= 0) continue;

    // 这一档能给出的最高 Rating（用该档的达成率上限）
    final needed = (targetRating - bonus) / (levelValue * step.coefficient) * 100;
    if (needed <= step.minimum) continue; // 这一档的要求比门槛低，说明上一档够
    if (needed <= 100.5 && needed >= step.minimum) {
      return needed;
    }
  }

  // 兜底：用最高系数算一次
  final top = dxRatingCoefficients.first;
  final needed = (targetRating - bonus) / (levelValue * top.coefficient) * 100;
  if (needed > achievementCap) return null; // 打满也不够
  return needed;
}
