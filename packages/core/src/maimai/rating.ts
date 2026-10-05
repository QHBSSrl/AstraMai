/**
 * 舞萌 DX 单曲 Rating 计算。
 *
 * 官方计算式（maimai DX CiRCLE 起）：
 *
 *   DX Rating値 = 譜面定数 × min(達成率, 100.5%) × ランク係数 + APボーナス(1点)
 *   小数点以下切り捨て
 *
 * 其中「ランク係数」按达成率落档取值：同一评级档内，达到该档**最高**达成率时
 * 会取得比档内常规值更高的系数（例如 SSS 档 100.4999% 取 22.2，而 100.0000% 取 21.6）。
 *
 * 系数表与示例依据萌娘百科「maimai系列」条目整理：
 *   https://zh.moegirl.org.cn/ja/Maimai系列
 * 并可与落雪 API 返回的 `dx_rating` 逐条对拍（见 `verifyScoreRating`）。
 */

import type { FCType, MaimaiScore, RateType } from '../lxns/types.js';

/** 达成率上限：超过 100.5% 的部分不参与计算。 */
export const ACHIEVEMENT_CAP = 100.5;

/** 最高理论达成率（AP+）。 */
export const ACHIEVEMENT_MAX = 101.0;

/** ランク係数表的一项。按 `minimum` 降序排列，取第一个满足 `achievement >= minimum` 的项。 */
export interface RatingCoefficientStep {
  /** 该系数适用的达成率下限（百分数）。 */
  minimum: number;
  /** 系数。 */
  coefficient: number;
  /** 该步进的说明，仅用于界面提示。 */
  note?: string;
}

/**
 * ランク係数表（降序）。
 *
 * 「同档顶格」步进的达成率写成 100.4999 这类值——这是游戏内达成率的显示精度上限，
 * 也是实际能取到该系数的达成率。
 */
export const DX_RATING_COEFFICIENTS: readonly RatingCoefficientStep[] = [
  { minimum: 100.5, coefficient: 22.4, note: 'SSS+' },
  { minimum: 100.4999, coefficient: 22.2, note: 'SSS 顶格' },
  { minimum: 100.0, coefficient: 21.6, note: 'SSS' },
  { minimum: 99.9999, coefficient: 21.4, note: 'SS+ 顶格' },
  { minimum: 99.5, coefficient: 21.1, note: 'SS+' },
  { minimum: 99.0, coefficient: 20.8, note: 'SS' },
  { minimum: 98.9999, coefficient: 20.6, note: 'S+ 顶格' },
  { minimum: 98.0, coefficient: 20.3, note: 'S+' },
  { minimum: 97.0, coefficient: 20.0, note: 'S' },
  { minimum: 96.9999, coefficient: 17.6, note: 'AAA 顶格' },
  { minimum: 94.0, coefficient: 16.8, note: 'AAA' },
  { minimum: 90.0, coefficient: 15.2, note: 'AA' },
  { minimum: 80.0, coefficient: 13.6, note: 'A' },
  { minimum: 79.9999, coefficient: 12.8, note: 'BBB 顶格' },
  { minimum: 75.0, coefficient: 12.0, note: 'BBB' },
  { minimum: 70.0, coefficient: 11.2, note: 'BB' },
  { minimum: 60.0, coefficient: 9.6, note: 'B' },
  { minimum: 50.0, coefficient: 8.0, note: 'C' },
  { minimum: 40.0, coefficient: 6.4, note: 'D' },
  { minimum: 30.0, coefficient: 4.8, note: 'D' },
  { minimum: 20.0, coefficient: 3.2, note: 'D' },
  { minimum: 10.0, coefficient: 1.6, note: 'D' },
  { minimum: 0.0, coefficient: 0.0, note: '低于 10% 不计分' },
];

/** 评级档位门槛，用于由达成率反推评级。 */
export const RATE_THRESHOLDS: readonly { rate: RateType; minimum: number }[] = [
  { rate: 'sssp', minimum: 100.5 },
  { rate: 'sss', minimum: 100.0 },
  { rate: 'ssp', minimum: 99.5 },
  { rate: 'ss', minimum: 99.0 },
  { rate: 'sp', minimum: 98.0 },
  { rate: 's', minimum: 97.0 },
  { rate: 'aaa', minimum: 94.0 },
  { rate: 'aa', minimum: 90.0 },
  { rate: 'a', minimum: 80.0 },
  { rate: 'bbb', minimum: 75.0 },
  { rate: 'bb', minimum: 70.0 },
  { rate: 'b', minimum: 60.0 },
  { rate: 'c', minimum: 50.0 },
  { rate: 'd', minimum: 0.0 },
];

/**
 * 归一化达成率。
 *
 * 落雪 API 使用百分数（`100.5`）；部分数据源使用万分位（`1005000`）。
 * 这里统一折算为百分数，并夹在 [0, 101] 内。
 */
export function normalizeAchievement(achievement: number): number {
  if (!Number.isFinite(achievement)) return 0;
  const percent = achievement > ACHIEVEMENT_MAX && achievement <= ACHIEVEMENT_MAX * 10_000
    ? achievement / 10_000
    : achievement;
  return Math.min(Math.max(percent, 0), ACHIEVEMENT_MAX);
}

/** 按达成率取ランク係数；低于 10% 时为 0。 */
export function dxRatingCoefficient(achievement: number): number {
  const percent = normalizeAchievement(achievement);
  for (const step of DX_RATING_COEFFICIENTS) {
    if (percent >= step.minimum) return step.coefficient;
  }
  return 0;
}

/** 命中该系数的步进（含说明），用于「为什么是这个分」的解释。 */
export function dxRatingCoefficientStep(achievement: number): RatingCoefficientStep {
  const percent = normalizeAchievement(achievement);
  return (
    DX_RATING_COEFFICIENTS.find((step) => percent >= step.minimum) ??
    DX_RATING_COEFFICIENTS[DX_RATING_COEFFICIENTS.length - 1]!
  );
}

export interface DxRatingOptions {
  /**
   * 是否为 ALL PERFECT（含 AP+）。为 true 时计入 +1 的 AP 加分。
   * 默认依据成绩的 `fc` 字段自动判定。
   */
  allPerfect?: boolean | undefined;
}

/** 判断成绩是否属于 ALL PERFECT（AP / AP+）。 */
export function isAllPerfect(fc: FCType | null | undefined): boolean {
  return fc === 'ap' || fc === 'app';
}

/**
 * 计算单曲 DX Rating（向下取整）。
 *
 * @param levelValue 谱面定数，如 `14.9`
 * @param achievement 达成率（百分数或万分位）
 * @param options 可选；`allPerfect` 用于控制 AP 加分
 */
export function calculateDxRating(
  levelValue: number,
  achievement: number,
  options: DxRatingOptions = {},
): number {
  if (!Number.isFinite(levelValue) || levelValue < 0) return 0;
  const percent = Math.min(normalizeAchievement(achievement), ACHIEVEMENT_CAP);
  const coefficient = dxRatingCoefficient(percent);
  const base = levelValue * (percent / 100) * coefficient;
  const bonus = options.allPerfect ? 1 : 0;
  // 加 1e-9 抵消浮点误差（例如 14.9 * 1.005 * 22.4 落在 335.4288… 附近）
  return Math.floor(base + bonus + 1e-9);
}

/** 某定数在给定达成率下的理论单曲 Rating（AP+ 满分）。 */
export function maxRatingForLevel(levelValue: number): number {
  return calculateDxRating(levelValue, ACHIEVEMENT_CAP, { allPerfect: true });
}

/** 由达成率反推评级码。 */
export function rateFromAchievement(achievement: number): RateType {
  const percent = normalizeAchievement(achievement);
  return RATE_THRESHOLDS.find((threshold) => percent >= threshold.minimum)?.rate ?? 'd';
}

/** 某评级档的最低达成率（百分数）。 */
export function minimumAchievementForRate(rate: RateType): number {
  return RATE_THRESHOLDS.find((threshold) => threshold.rate === rate)?.minimum ?? 0;
}

/**
 * 反推「达到目标单曲 Rating 所需的最低定数」，向上取整到 0.1。
 * 用于推分建议：给定达成率，看看需要多高定数的谱面才够分。
 */
export function requiredLevelValue(targetRating: number, achievement: number): number | undefined {
  if (!Number.isFinite(targetRating) || targetRating <= 0) return 0;
  const percent = Math.min(normalizeAchievement(achievement), ACHIEVEMENT_CAP);
  const perLevel = dxRatingCoefficient(percent) * (percent / 100);
  if (perLevel <= 0) return undefined;
  return Math.ceil((targetRating / perLevel) * 10) / 10;
}

// ── 公式自检 ────────────────────────────────────────────────────────────

export interface ScoreRatingVerification {
  /** 我们按公式算出的单曲 Rating。 */
  computed: number;
  /** 不含 AP 加分的结果（用于判断落雪的 dx_rating 是否已含 AP 加分）。 */
  computedWithoutApBonus: number;
  /** 落雪返回的 dx_rating 向下取整；缺失时为 null。 */
  api: number | null;
  /** 落雪返回的原始浮点值。 */
  apiRaw: number | null;
  /** 是否与落雪一致。 */
  matches: boolean | null;
  /** 忽略 AP 加分时是否与落雪一致。 */
  matchesWithoutApBonus: boolean | null;
  /** 计算所用的定数。 */
  levelValue: number;
  /** 计算所用的达成率（已归一化、已封顶）。 */
  achievement: number;
  /** 命中的系数步进。 */
  step: RatingCoefficientStep;
  /** 实际应用的 AP 加分。 */
  apBonus: number;
}

/**
 * 对拍单条成绩：用本地公式算一遍，再和落雪给的 `dx_rating` 比对。
 *
 * 这是本工程刻意保留的验证手段——真实密钥下跑一次 B50，就能看到数百条成绩的
 * 一致率；若出现系统性偏差，说明公式或接口语义需要修正。
 */
export function verifyScoreRating(score: MaimaiScore, levelValue: number): ScoreRatingVerification {
  const allPerfect = isAllPerfect(score.fc);
  const computed = calculateDxRating(levelValue, score.achievements, { allPerfect });
  const computedWithoutApBonus = calculateDxRating(levelValue, score.achievements, { allPerfect: false });

  const apiRaw = typeof score.dx_rating === 'number' && Number.isFinite(score.dx_rating) ? score.dx_rating : null;
  const api = apiRaw === null ? null : Math.floor(apiRaw + 1e-9);

  return {
    computed,
    computedWithoutApBonus,
    api,
    apiRaw,
    matches: api === null ? null : api === computed,
    matchesWithoutApBonus: api === null ? null : api === computedWithoutApBonus,
    levelValue,
    achievement: Math.min(normalizeAchievement(score.achievements), ACHIEVEMENT_CAP),
    step: dxRatingCoefficientStep(score.achievements),
    apBonus: allPerfect ? 1 : 0,
  };
}
