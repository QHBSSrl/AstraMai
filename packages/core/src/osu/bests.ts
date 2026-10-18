/**
 * osu! 成绩视图：把领域数据整理成**界面直接能用**的形状。
 *
 * ── 为什么服务端造视图，而不是把原始数据丢给客户端 ──────────────────
 *
 * 手表是**受限环境**：内存小、没有格式化能力、每一行多一个字段都是成本。
 * 而且格式化逻辑（怎么拼曲名、pp 保留几位、准确率怎么显示）
 * 必须在 Web 测试站和手表上**完全一致**，放在 core 里只有一份实现。
 *
 * 这和 `buildChunithmBestsView` 是同一个理由。
 */

import {
  formatOsuAccuracy,
  formatOsuPp,
  formatOsuRank,
  OSU_RULESET_LABEL,
  type OsuBests,
  type OsuPlayer,
  type OsuRuleset,
  type OsuScore,
} from './types.js';

/** 一条成绩，已经算好显示用的字符串。 */
export interface OsuScoreEntry {
  /** 列表里的序号，从 1 开始。 */
  position: number;

  /** 这次成绩的 pp。 */
  pp: number;
  /** 显示用：`1857.11` / `1234`（上万取整）。 */
  ppText: string;
  /** 加权后的贡献。 */
  weightedPp: number;
  /** 权重百分比，如 100 / 95 / 90.25。 */
  weightPercent: number;
  /**
   * 显示用：`100%` / `85.74%`。
   *
   * 上游给的是**累计乘积**，原始值是 `85.73749999999998` 这种
   * 一长串浮点噪声——直接显示会很难看。这里统一格式化。
   */
  weightPercentText: string;

  /** 准确率 0–1。 */
  accuracy: number;
  /** 显示用：`97.44%`。 */
  accuracyText: string;
  /** 评级字母。 */
  rank: string;
  /** MOD 缩写，如 `['HD', 'DT']`。 */
  mods: string[];
  /** 显示用：`HD DT`，无 MOD 时为空串。 */
  modsText: string;

  /** 游戏内原始分数。 */
  score: number;
  maxCombo: number;

  beatmapId: number;
  /** 难度名。 */
  version: string;
  /** 星数。 */
  starRating: number;
  /** 显示用：`6.1`。 */
  starRatingText: string;

  /** 曲名。 */
  songTitle: string;
  /** 艺术家。 */
  artist: string;
  /** `艺术家 - 曲名`，两者都有时才加分隔符。 */
  title: string;
  /** 曲绘。可能为空。 */
  coverUrl: string;
}

/** 玩家名片。 */
export interface OsuPlayerCard {
  id: number;
  name: string;
  pp: number;
  /** 显示用 pp。 */
  ppText: string;
  globalRank: number | null;
  /** 显示用：`#1`，没有排名时 `—`。 */
  globalRankText: string;
  countryRank: number | null;
  countryCode: string;
  accuracy: number;
  accuracyText: string;
  playCount: number;
  ruleset: OsuRuleset;
  /** 玩法的人类可读名。 */
  rulesetLabel: string;
  avatarUrl: string;
}

export interface OsuBestsStats {
  /** 列表里的条数。 */
  count: number;
  /**
   * 列表里这些成绩**加权后**贡献的 pp 之和。
   *
   * ⚠️ 这**不等于**总 pp：osu! 的 pp 是所有 play 加权求和，
   * 而列表只取前 N 条。UI 上要把这个区别说清楚，不要让玩家以为对不上。
   */
  listedPpSum: number;
  /** 列表里这些成绩的**未加权** pp 之和（更能反映「水平」）。 */
  rawPpSum: number;
  /** 玩家的总 pp。 */
  totalPp: number;
  totalPpText: string;
  /** 最好一条的 pp。 */
  topPp: number;
  /** 最高星数。 */
  topStarRating: number;
}

export interface OsuBestsView {
  game: 'osu';
  player: OsuPlayerCard;
  scores: OsuScoreEntry[];
  stats: OsuBestsStats;
  /** 列表是不是被截断了（还有更多没显示）。 */
  truncated: boolean;
  generatedAt: string;
}

/** 星数保留一位小数。 */
function formatStar(value: number): string {
  return Number.isFinite(value) && value > 0 ? value.toFixed(1) : '—';
}

/** 权重百分比：整数就不带小数（100 而不是 100.00）。 */
function formatWeight(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

export function toOsuScoreEntry(score: OsuScore, position: number): OsuScoreEntry {
  return {
    position,

    pp: score.pp,
    ppText: formatOsuPp(score.pp),
    weightedPp: score.weightedPp,
    weightPercent: score.weightPercent,
    weightPercentText: `${formatWeight(score.weightPercent)}%`,

    accuracy: score.accuracy,
    accuracyText: formatOsuAccuracy(score.accuracy),
    rank: score.rank,
    mods: score.mods,
    modsText: score.mods.join(' '),

    score: score.score,
    maxCombo: score.maxCombo,

    beatmapId: score.beatmapId,
    version: score.version,
    starRating: score.starRating,
    starRatingText: formatStar(score.starRating),

    songTitle: score.songTitle,
    artist: score.artist,
    title: score.title,
    coverUrl: score.coverUrl,
  };
}

export function buildOsuBestsView(input: {
  player: OsuPlayer;
  bests: OsuBests;
}): OsuBestsView {
  const { player, bests } = input;

  const scores = bests.scores.map((score, index) => toOsuScoreEntry(score, index + 1));

  /*
   * `listedPpSum` 用**加权后**的值：那才是这些成绩对总 pp 的真实贡献。
   * 玩家看到「加起来不等于总 pp」时，原因就是列表被截断了——
   * 所以 `truncated` 要一起给出去。
   */
  const listedPpSum = scores.reduce((sum, entry) => sum + entry.weightedPp, 0);
  const rawPpSum = scores.reduce((sum, entry) => sum + entry.pp, 0);

  return {
    game: 'osu',
    player: {
      id: player.id,
      name: player.username,
      pp: player.pp,
      ppText: formatOsuPp(player.pp),
      globalRank: player.globalRank,
      globalRankText: formatOsuRank(player.globalRank),
      countryRank: player.countryRank,
      countryCode: player.countryCode,
      accuracy: player.accuracy,
      accuracyText: formatOsuAccuracy(player.accuracy),
      playCount: player.playCount,
      ruleset: player.ruleset,
      rulesetLabel: OSU_RULESET_LABEL[player.ruleset],
      avatarUrl: player.avatarUrl,
    },
    scores,
    stats: {
      count: scores.length,
      listedPpSum,
      rawPpSum,
      totalPp: bests.totalPp,
      totalPpText: formatOsuPp(bests.totalPp),
      topPp: scores.length > 0 ? (scores[0]?.pp ?? 0) : 0,
      topStarRating: scores.reduce((max, entry) => Math.max(max, entry.starRating), 0),
    },
    truncated: bests.truncated,
    generatedAt: new Date().toISOString(),
  };
}

/** 权重百分比的显示文本，给需要单独展示的地方用。 */
export function weightText(entry: OsuScoreEntry): string {
  return `${formatWeight(entry.weightPercent)}%`;
}
