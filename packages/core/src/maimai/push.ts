/**
 * 舞萌 DX 推分：**从「我想要多少 rating」反算「我得打多少」**。
 *
 * ── 为什么这个模块单独存在 ──────────────────────────────────────────
 *
 * `rating.ts` 解决的是 `定数 + 达成率 → rating`（正算）。
 * 但玩家真正会问的是反过来的问题：
 *
 *   「这首歌我现在 98.5%，打上去能加多少？」
 *   「我想把这条从 283 提到 290，需要打到多少？」
 *   「这个定数最多能给我多少分？值不值得练？」
 *
 * 正算的三个函数答不了这些，所以这里做反算。
 *
 * ── 反算为什么不能直接除 ────────────────────────────────────────────
 *
 * `rating = floor(定数 × 达成率/100 × 系数)`，而**系数是分档的常数**——
 * 达成率 99.0% 和 99.4% 的系数是一样的（都是 20.8），
 * 但到了 99.5% 会跳到 21.1。
 *
 * 所以直接 `目标 / (定数 × 系数)` 解出来的达成率，很可能落在**别的档**里，
 * 代回去算出来的 rating 是错的。
 *
 * 正确做法：**逐档试**，每一档解出达成率、检查它是否落在本档区间内，
 * 再代回 `calculateDxRating` 验证。
 * 从最低档往上试，这样得到的是「**最低需要打多少**」——
 * 玩家要的就是这个，不是"随便一个能到的方案"。
 */

import {
  ACHIEVEMENT_CAP,
  DX_RATING_COEFFICIENTS,
  calculateDxRating,
  maxRatingForLevel,
  normalizeAchievement,
} from './rating.js';

/** 达成率在游戏里的显示精度：小数点后 4 位。 */
const ACHIEVEMENT_STEP = 10000;

export interface PushOptions {
  /**
   * 是否按 ALL PERFECT 算（有 +1 加分）。
   * 不传就当不是 —— 推分时按"不打 AP"算是更保守、更可执行的建议。
   */
  allPerfect?: boolean | undefined;
}

/** 「要打到多少」的答案。 */
export interface AchievementTarget {
  /** 需要的达成率（百分数，已向上取整到 4 位小数）。 */
  achievement: number;
  /** 届时单曲 rating。 */
  rating: number;
  /** 该达成率落到的系数。 */
  coefficient: number;
  /** 系数对应的档位说明，如 `SSS`，仅用于界面提示。 */
  note?: string | undefined;
}

/**
 * 反算「要把某定数的谱面打到多少达成率，单曲 rating 才够 `targetRating`」。
 *
 * @param levelValue 谱面定数，如 `14.9`
 * @param targetRating 目标单曲 rating（整数）
 * @returns 打不到时返回 `undefined`（这个定数的天花板不够）
 */
export function requiredAchievement(
  levelValue: number,
  targetRating: number,
  options: PushOptions = {},
): AchievementTarget | undefined {
  if (!Number.isFinite(levelValue) || levelValue <= 0) return undefined;
  if (!Number.isFinite(targetRating) || targetRating <= 0) return undefined;

  const bonus = options.allPerfect ? 1 : 0;
  const need = targetRating - bonus;

  // 目标低到连 AP 加分都够，那随便打都在目标内
  if (need <= 0) {
    return { achievement: 0, rating: targetRating, coefficient: 0, note: undefined };
  }

  // 从**最低档**往上试 —— 这样给出的是最低需要打多少
  for (let index = DX_RATING_COEFFICIENTS.length - 1; index >= 0; index -= 1) {
    const step = DX_RATING_COEFFICIENTS[index]!;
    if (step.coefficient <= 0) continue;

    // 这一档下，达到 need 需要的达成率
    const raw = (need / (levelValue * step.coefficient)) * 100;

    // 本档的达成率区间 [minimum, nextMinimum]
    const lower = step.minimum;
    const upper = index === 0 ? ACHIEVEMENT_CAP : DX_RATING_COEFFICIENTS[index - 1]!.minimum;

    /*
     * ⚠️ **`raw < lower` 不是"这一档不行"，而是"这一档的最低达成率就够了"。**
     *
     * 之前这里写的是 `if (raw < lower) continue`，于是低目标全部解不出来
     * （例如定数 8 打 1 分：raw = 7.8%，而这一档从 10% 起）。
     * 但 10% 本身就能给出 1 分 —— 取 `lower` 才是对的。
     */
    const candidate = Math.max(raw, lower);

    // 落到了更高档 → 这一档给不出目标，往上试
    if (candidate > upper) continue;
    if (candidate > ACHIEVEMENT_CAP) continue;

    // 向上取整到游戏精度，保证 floor 之后不会掉回目标以下
    const achievement = Math.ceil(candidate * ACHIEVEMENT_STEP) / ACHIEVEMENT_STEP;
    if (achievement > ACHIEVEMENT_CAP) continue;

    const rating = calculateDxRating(levelValue, achievement, options);
    // 浮点/取整之后仍然不够 → 这一步不成立
    if (rating < targetRating) continue;

    return {
      achievement,
      rating,
      coefficient: step.coefficient,
      note: step.note,
    };
  }

  return undefined;
}

/**
 * 某定数能给出的**最低**单曲 Rating。
 *
 * 达成率低于 10% 时系数是 0，一分都没有，所以这是"打底分"。
 *
 * ⚠️ **不要用它判断"目标打不到"。** 反算的语义是「至少拿到 target」，
 * 所以 target 低于这个值时照样有解 —— 只是实际会**超过** target 而已
 * （例如定数 12.5 要 1 分，答案是 10%，实际给 2 分）。
 *
 * 真正"打不到"只有一种情况：**target 高于天花板**。
 * 这个函数是给界面展示用的（"这个定数最低也有 2 分"）。
 */
export function minRatingForLevel(levelValue: number): number {
  if (!Number.isFinite(levelValue) || levelValue <= 0) return 0;
  // 系数表里最低的非零档（10.0% / 1.6）
  const lowest = [...DX_RATING_COEFFICIENTS]
    .reverse()
    .find((step) => step.coefficient > 0);
  if (!lowest) return 0;
  return calculateDxRating(levelValue, lowest.minimum);
}

/** 一条推分建议。 */
export interface PushPlan {
  /** 谱面定数。 */
  levelValue: number;
  /** 当前成绩；没打过时为 `null`。 */
  current: { achievement: number; rating: number } | null;
  /** 目标单曲 rating。 */
  target: number;
  /** 还差多少分（负数表示已经超了）。 */
  gap: number;
  /** 需要打到的达成率；`undefined` 表示这个定数打不到。 */
  required: AchievementTarget | undefined;
  /** 这个定数的天花板（AP+ 满分）。 */
  ceiling: number;
}

/**
 * 完整的推分视角：当前 → 目标。
 *
 * @param levelValue 谱面定数
 * @param currentAchievement 当前达成率（百分数）；没打过传 `null`
 * @param targetRating 目标单曲 rating
 */
export function pushPlan(
  levelValue: number,
  currentAchievement: number | null,
  targetRating: number,
  options: PushOptions = {},
): PushPlan {
  const ceiling = maxRatingForLevel(levelValue);

  const current =
    currentAchievement === null || !Number.isFinite(currentAchievement)
      ? null
      : {
          achievement: normalizeAchievement(currentAchievement),
          rating: calculateDxRating(levelValue, currentAchievement, options),
        };

  const gap = targetRating - (current?.rating ?? 0);

  return {
    levelValue,
    current,
    target: targetRating,
    gap,
    required: requiredAchievement(levelValue, targetRating, options),
    ceiling,
  };
}

/** 达成率跨档时 rating 会跳多少 —— 用来告诉玩家「再打 0.1% 能多拿几分」。 */
export interface GainRow {
  /** 该档的最低达成率。 */
  achievement: number;
  /** 在这个达成率下的单曲 rating。 */
  rating: number;
  /** 相比上一档多了几分。 */
  gain: number;
  /** 档位说明，如 `SSS`。 */
  note?: string | undefined;
}

/**
 * 某定数的「档位收益表」。
 *
 * 按达成率**从低到高**返回每一档的最低达成率与对应 rating，
 * 以及相比上一档多出来的分。
 *
 * 为什么有用：玩家常常不知道该冲哪一档 ——
 * 这张表直接告诉你「从 99.0% 冲到 99.5% 能多 3 分，但再冲 0.5% 到 100% 只能多 2 分」。
 */
export function gainTable(levelValue: number, options: PushOptions = {}): GainRow[] {
  if (!Number.isFinite(levelValue) || levelValue <= 0) return [];

  // DX_RATING_COEFFICIENTS 是降序的，这里翻成升序
  const ascending = [...DX_RATING_COEFFICIENTS].reverse();

  const rows: GainRow[] = [];
  let previousRating = 0;

  for (const step of ascending) {
    const achievement = Math.min(step.minimum, ACHIEVEMENT_CAP);
    const rating = calculateDxRating(levelValue, achievement, options);
    rows.push({
      achievement,
      rating,
      gain: rating - previousRating,
      note: step.note,
    });
    previousRating = rating;
  }

  return rows;
}

/**
 * 从 B35/B15 里挑「提升空间最大」的条目。
 *
 * 提升空间 = `天花板 - 当前 rating`。这个值大说明「这条你还没打到位，
 * 而且定数高，练一下收益最大」。
 *
 * ⚠️ **不排序玩家已经打满的条目**（差值为 0 的会被过滤掉），
 * 否则列表里全是 SS 以上的成绩，看不出该练什么。
 */
export interface ImprovementCandidate<T> {
  entry: T;
  /** 当前单曲 rating。 */
  current: number;
  /** 该定数的天花板。 */
  ceiling: number;
  /** 还差多少到天花板。 */
  headroom: number;
}

export function improvementCandidates<T>(
  entries: readonly T[],
  pick: (entry: T) => { levelValue: number; rating: number } | null,
  limit = 5,
): ImprovementCandidate<T>[] {
  const candidates: ImprovementCandidate<T>[] = [];

  for (const entry of entries) {
    const values = pick(entry);
    if (!values) continue;
    if (!Number.isFinite(values.levelValue) || values.levelValue <= 0) continue;

    const ceiling = maxRatingForLevel(values.levelValue);
    const headroom = ceiling - values.rating;
    if (headroom <= 0) continue;

    candidates.push({ entry, current: values.rating, ceiling, headroom });
  }

  candidates.sort((a, b) => b.headroom - a.headroom);
  return candidates.slice(0, limit);
}
