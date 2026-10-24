/**
 * 两次 B50 的对比：**这次比上次强在哪、弱在哪**。
 *
 * ── 为什么需要 ──────────────────────────────────────────────────────
 *
 * 查分工具都在告诉你「你现在的分数」，但玩家真正关心的是「**我进步了吗**」。
 * 尤其是音游：一个周末打上去几分，比总分本身更有反馈感。
 *
 * 而且上一轮刚做了离线缓存 —— 上一次的 view 已经存在设备上了，
 * 这是天然的数据源，不用额外存任何东西。
 *
 * ── 匹配靠什么 ──────────────────────────────────────────────────────
 *
 * 按 **`songId + type + levelIndex`** 匹配（同一首曲子的同一个难度）。
 *
 * 为什么不用曲名：改名、别名、版本差异都可能对不上。
 * 为什么不用 `rating`：那正是要比的东西。
 * **`songId` 在落雪的曲库里是稳定的**，`type` 区分标准/ DX 谱，
 * `levelIndex` 区分难度 —— 三者组合唯一确定一张谱面。
 *
 * ── 一个容易搞错的地方 ──────────────────────────────────────────────
 *
 * B50 会**换血**。这周排进 B50 的 50 张谱，下周可能被别的挤掉。
 * 所以对比结果有四种，不能只算「涨了 / 掉了」：
 *
 *   涨了   （上次有、这次有、分变高）
 *   掉了   （上次有、这次有、分变低）
 *   新进   （这次有、上次没有）
 *   掉出   （上次有、这次没有）
 *
 * 「掉出」不代表成绩掉了 —— 是**别的谱打得更好把它挤出去了**。
 * 这两件事在界面上必须分开说，否则用户会以为自己的成绩丢了。
 */

import type { B50Entry, B50View } from './b50.js';

/** 一张谱面的稳定标识。 */
function entryKey(entry: B50Entry): string {
  // songId 优先级最高；缺失时退回曲名（旧缓存可能没有 songId）
  const id = typeof entry.songId === 'number' && entry.songId > 0 ? String(entry.songId) : entry.title;
  return `${id}:${String(entry.type)}:${entry.levelIndex}`;
}

/** 对比结果里的一条。 */
export interface DiffEntry {
  /** 匹配用的稳定标识。 */
  key: string;

  songId: number;
  title: string;
  difficultyShort: string;
  difficultyColor: string;
  levelValue: number | null;

  /** 上次的分数；这次新进的为 `null`。 */
  previous: { rating: number; achievements: number } | null;
  /** 这次的分数；掉出的为 `null`。 */
  next: { rating: number; achievements: number } | null;

  /** rating 变化（掉出为负的旧值，新进为正值）。 */
  deltaRating: number;
  /** 达成率变化。 */
  deltaAchievement: number;
}

/** 一次对比的结果。 */
export interface B50Diff {
  /** 涨了的，按涨幅降序。 */
  gained: DiffEntry[];
  /** 掉了的，按跌幅降序（跌得最多的在前）。 */
  lost: DiffEntry[];
  /** 这次新进 B50 的，按 rating 降序。 */
  entered: DiffEntry[];
  /** 这次掉出 B50 的，按上次 rating 降序。 */
  left: DiffEntry[];
  /** 分数没变的条数。 */
  unchanged: number;

  /** 两次的玩家总 Rating。 */
  previousRating: number;
  nextRating: number;
  /** 总 Rating 变化。 */
  ratingDelta: number;

  /** 有没有可比的东西（上次没有数据时为 false）。 */
  comparable: boolean;
}

function toSnapshot(entry: B50Entry): { rating: number; achievements: number } {
  return {
    rating: typeof entry.rating === 'number' ? entry.rating : 0,
    achievements: typeof entry.achievements === 'number' ? entry.achievements : 0,
  };
}

function toDiffEntry(
  key: string,
  previous: B50Entry | null,
  next: B50Entry | null,
): DiffEntry {
  // 两张里至少有一张非空
  const source = (next ?? previous)!;
  const before = previous ? toSnapshot(previous) : null;
  const after = next ? toSnapshot(next) : null;

  return {
    key,
    songId: typeof source.songId === 'number' ? source.songId : 0,
    title: source.title || '',
    difficultyShort: source.difficultyShort || '',
    difficultyColor: source.difficultyColor || '',
    levelValue: typeof source.levelValue === 'number' ? source.levelValue : null,
    previous: before,
    next: after,
    deltaRating: (after?.rating ?? 0) - (before?.rating ?? 0),
    deltaAchievement: (after?.achievements ?? 0) - (before?.achievements ?? 0),
  };
}

/**
 * 对比两份 B50 视图。
 *
 * @param previous 上次的视图；没有就传 `null`，此时 `comparable` 为 false
 * @param next 这次的视图
 */
export function diffB50(previous: B50View | null, next: B50View): B50Diff {
  const nextRating = typeof next.player?.rating === 'number' ? next.player.rating : 0;

  if (!previous) {
    return {
      gained: [],
      lost: [],
      entered: [],
      left: [],
      unchanged: 0,
      previousRating: 0,
      nextRating,
      ratingDelta: 0,
      comparable: false,
    };
  }

  const previousRating = typeof previous.player?.rating === 'number' ? previous.player.rating : 0;

  // B50 = 旧曲 B35 + 新曲 B15，两组都要比
  const flatten = (view: B50View): Map<string, B50Entry> => {
    const map = new Map<string, B50Entry>();
    for (const entry of [...(view.standard ?? []), ...(view.dx ?? [])]) {
      map.set(entryKey(entry), entry);
    }
    return map;
  };

  const before = flatten(previous);
  const after = flatten(next);

  const gained: DiffEntry[] = [];
  const lost: DiffEntry[] = [];
  const entered: DiffEntry[] = [];
  const left: DiffEntry[] = [];
  let unchanged = 0;

  for (const [key, entry] of after) {
    const old = before.get(key);

    if (!old) {
      entered.push(toDiffEntry(key, null, entry));
      continue;
    }

    const diff = toDiffEntry(key, old, entry);
    if (diff.deltaRating > 0) gained.push(diff);
    else if (diff.deltaRating < 0) lost.push(diff);
    // rating 没变也算"没变"，哪怕达成率动了 —— 那对总分没影响
    else unchanged += 1;
  }

  for (const [key, entry] of before) {
    if (after.has(key)) continue;
    left.push(toDiffEntry(key, entry, null));
  }

  gained.sort((a, b) => b.deltaRating - a.deltaRating);
  // 跌得最多的排前面 —— 用户更想看哪条掉得厉害
  lost.sort((a, b) => a.deltaRating - b.deltaRating);
  entered.sort((a, b) => (b.next?.rating ?? 0) - (a.next?.rating ?? 0));
  left.sort((a, b) => (b.previous?.rating ?? 0) - (a.previous?.rating ?? 0));

  return {
    gained,
    lost,
    entered,
    left,
    unchanged,
    previousRating,
    nextRating,
    ratingDelta: nextRating - previousRating,
    comparable: true,
  };
}

/**
 * 一句话总结（给手表那种放不下列表的地方用）。
 *
 * 没有变化时返回 `null` —— 界面据此不显示任何东西，
 * 而不是显示"较上次持平"这种占地方又没信息量的话。
 */
export function summarizeDiff(diff: B50Diff): string | null {
  if (!diff.comparable) return null;

  const parts: string[] = [];

  if (diff.ratingDelta !== 0) {
    const sign = diff.ratingDelta > 0 ? '+' : '';
    parts.push(`总 Rating ${sign}${diff.ratingDelta}`);
  }
  if (diff.gained.length > 0) parts.push(`${diff.gained.length} 首涨`);
  if (diff.lost.length > 0) parts.push(`${diff.lost.length} 首跌`);
  if (diff.entered.length > 0) parts.push(`${diff.entered.length} 首新进`);

  if (parts.length === 0) return null;
  return parts.join(' · ');
}
