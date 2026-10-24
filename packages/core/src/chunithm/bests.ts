/**
 * 中二节奏成绩视图组装。
 *
 * 对应舞萌那边的 `buildB50View`：把「玩家 + 成绩 + 曲库」拼成客户端
 * 可以直接渲染的视图模型。
 *
 * 和舞萌的差异（这些不是细节，是玩法本身不同）：
 *   舞萌是   B35（旧曲）+ B15（新曲），合成 B50
 *   中二是   **B30 + Selection 10 + Recent 10**，三组并列
 *   舞萌的 Rating 需要我们按公式复刻；**中二的 Rating 由接口直接给出**
 *
 * 三组的意义不同，所以视图里**并列返回、不合成一个榜单**——
 * 合成会让玩家看不出哪条是 Best、哪条只是最近打的。
 *
 * ── ⚠️ 别"修"这里的一处看起来不对的地方 ────────────────────────────
 *
 * `player.rating`（玩家总 Rating）和 `bestsRatingSum`（B30 单曲 Rating 相加）
 * **本来就不是一回事**，两个数对不上是**正常的**：
 *
 *   总 Rating  是官方按整套算法算出来的整体值
 *   B30 之和   是把 30 条单曲 Rating 直接相加
 *
 * 实测过：某玩家显示单曲 `0.28`、B30 合计 `13.21`，看着像字段取错了，
 * 但**官方就是这么算的**（单曲 Rating 很小时，总 Rating 并不会等于它们的和）。
 *
 * 曾经把这个当成 bug 去查过一轮，结论是没问题。
 * 再看到"对不上"请先回来看这段，不要改公式。
 */

import {
  CHUNITHM_CLEAR_LABELS,
  CHUNITHM_CHAIN_LABELS,
  CHUNITHM_FC_LABELS,
  CHUNITHM_RANK_LABELS,
  chunithmDifficultyFullName,
  chunithmDifficultyName,
  chunithmJacketUrl,
  isChunithmNormalDifficulty,
  isChunithmWorldsEnd,
} from './constants.js';
import type {
  ChunithmBests,
  ChunithmPlayer,
  ChunithmScore,
  ChunithmSong,
  ChunithmSongList,
} from '../lxns/chunithm-types.js';

/** 单条成绩（已和曲库关联）。 */
export interface ChunithmScoreEntry {
  /** 原始成绩，保留以便后续扩展。 */
  score: ChunithmScore;

  songId: number;
  title: string;
  artist: string;
  genre: string;
  jacketUrl: string;

  levelIndex: number;
  /** 难度简称，如 `MST`。 */
  difficultyShort: string;
  /** 难度全称，如 `MASTER`。 */
  difficultyName: string;
  /** 难度标级，如 `14+`。 */
  level: string;
  /** 谱面定数。曲库里查不到时为 null。 */
  levelValue: number | null;

  /** 单曲 Rating（接口直接给）。 */
  rating: number;
  /** 分数。 */
  points: number;
  clearLabel: string;
  fullComboLabel: string | null;
  fullChainLabel: string | null;
  rankLabel: string | null;
  playTime: string | null;

  /**
   * 是不是 WORLD'S END。
   *
   * 单列出来而不是塞进难度序列：WE 的性质等同于舞萌的宴会场，
   * 是**独立的一类特殊谱面**，不是"比 ULTIMA 更难的难度"。
   */
  isWorldsEnd: boolean;
}

/** 玩家名片。 */
export interface ChunithmPlayerCard {
  name: string;
  /** 玩家等级。上游是 string。 */
  level: string;
  rating: number;
  friendCode: number | null;
  overPower: number;
  changeOverPower: number;
  iconUrl: string | null;
  namePlateUrl: string | null;
  trophyName: string | null;
  trophyColor: string | null;
  totalPlayCount: string | null;
  uploadTime: string | null;
}

export interface ChunithmBestsStats {
  bestsCount: number;
  selectionsCount: number;
  recentsCount: number;
  /** Best 30 的 Rating 之和——玩家常关心「这 30 条一共贡献多少」。 */
  bestsRatingSum: number;
  /** 出现过的难度档位（升序），用于 UI 决定显示哪几档。 */
  difficultiesPresent: number[];
  /** 有多少条是 WORLD'S END。 */
  worldsEndCount: number;
}

export interface ChunithmBestsView {
  game: 'chunithm';
  player: ChunithmPlayerCard;
  bests: ChunithmScoreEntry[];
  selections: ChunithmScoreEntry[];
  recents: ChunithmScoreEntry[];
  stats: ChunithmBestsStats;
  /** 曲库是否命中——没命中时难度定数会缺，界面要能说明原因。 */
  libraryMatched: boolean;
  generatedAt: string;
}

function trimOrNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function buildSongIndex(songs: ChunithmSongList | undefined): Map<number, ChunithmSong> {
  const index = new Map<number, ChunithmSong>();
  for (const song of songs?.songs ?? []) index.set(song.id, song);
  return index;
}

/**
 * 把一条成绩和曲库关联起来。
 *
 * 曲库里查不到也要能显示——成绩本身带着曲名和难度标级，
 * 缺的只是定数与曲绘。**因为查不到就整条丢掉，是更糟的选择。**
 */
export function toChunithmScoreEntry(
  score: ChunithmScore,
  index: Map<number, ChunithmSong>,
): ChunithmScoreEntry {
  const song = index.get(score.id);
  const chart = song?.difficulties?.find((item) => item.difficulty === score.level_index);

  const fullCombo = trimOrNull(score.full_combo ?? null);
  const fullChain = trimOrNull(score.full_chain ?? null);
  const rank = trimOrNull(score.rank ?? null);

  return {
    score,
    songId: score.id,
    title: song?.title ?? trimOrNull(score.song_name) ?? `#${score.id}`,
    artist: song?.artist ?? '',
    genre: song?.genre ?? '',
    jacketUrl: chunithmJacketUrl(score.id, 96),
    levelIndex: score.level_index,
    difficultyShort: chunithmDifficultyName(score.level_index),
    difficultyName: chunithmDifficultyFullName(score.level_index),
    // 曲库里有更准的标级，其次用成绩自带的
    level: chart?.level ?? trimOrNull(score.level) ?? '',
    levelValue: typeof chart?.level_value === 'number' ? chart.level_value : null,
    rating: typeof score.rating === 'number' ? score.rating : 0,
    points: score.score,
    clearLabel: CHUNITHM_CLEAR_LABELS[score.clear] ?? score.clear,
    fullComboLabel: fullCombo ? (CHUNITHM_FC_LABELS[fullCombo] ?? fullCombo) : null,
    fullChainLabel: fullChain ? (CHUNITHM_CHAIN_LABELS[fullChain] ?? fullChain) : null,
    rankLabel: rank ? (CHUNITHM_RANK_LABELS[rank] ?? rank.toUpperCase()) : null,
    playTime: trimOrNull(score.play_time ?? null),
    isWorldsEnd: isChunithmWorldsEnd(score.level_index),
  };
}

/** 组装中二成绩视图。 */
export function buildChunithmBestsView(input: {
  player: ChunithmPlayer;
  bests: ChunithmBests;
  songs?: ChunithmSongList | undefined;
  generatedAt?: string | undefined;
}): ChunithmBestsView {
  const index = buildSongIndex(input.songs);
  const bests = (input.bests.bests ?? []).map((score) => toChunithmScoreEntry(score, index));
  const selections = (input.bests.selections ?? []).map((score) => toChunithmScoreEntry(score, index));
  const recents = (input.bests.recents ?? []).map((score) => toChunithmScoreEntry(score, index));

  const all = [...bests, ...selections, ...recents];
  const difficultiesPresent = [...new Set(all.map((entry) => entry.levelIndex))].sort((a, b) => a - b);
  const worldsEndCount = all.filter((entry) => entry.isWorldsEnd).length;

  const player = input.player;

  return {
    game: 'chunithm',
    player: {
      name: player.name ?? '',
      // 上游的 level 是 string，原样带出去，别自作聪明转数字
      level: String(player.level ?? ''),
      rating: typeof player.rating === 'number' ? player.rating : 0,
      friendCode: typeof player.friend_code === 'number' ? player.friend_code : null,
      overPower: typeof player.over_power === 'number' ? player.over_power : 0,
      changeOverPower: typeof player.change_over_power === 'number' ? player.change_over_power : 0,
      iconUrl: trimOrNull(player.icon_url),
      namePlateUrl: null,
      trophyName: player.trophy?.name ?? null,
      trophyColor: player.trophy?.color ?? null,
      totalPlayCount: trimOrNull(player.total_play_count ?? null),
      uploadTime: trimOrNull(player.upload_time ?? null),
    },
    bests,
    selections,
    recents,
    stats: {
      bestsCount: bests.length,
      selectionsCount: selections.length,
      recentsCount: recents.length,
      bestsRatingSum: Number(bests.reduce((sum, entry) => sum + entry.rating, 0).toFixed(2)),
      difficultiesPresent,
      worldsEndCount,
    },
    // 只有曲库命中时才敢说定数是准的
    libraryMatched: index.size > 0,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
  };
}

/** 供 UI 决定显示哪几档难度（常规档位，WE 单独处理）。 */
export function normalDifficultiesPresent(view: ChunithmBestsView): number[] {
  return view.stats.difficultiesPresent.filter((item) => isChunithmNormalDifficulty(item));
}

/** 曲目别名查表，供搜索用。 */
export function chunithmAliasMap(
  aliases: { song_id: number; aliases: string[] }[] | undefined,
): Map<number, string[]> {
  const map = new Map<number, string[]>();
  for (const item of aliases ?? []) map.set(item.song_id, item.aliases ?? []);
  return map;
}
