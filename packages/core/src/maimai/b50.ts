/**
 * B50（Best 50）视图模型组装。
 *
 * 职责：把落雪的 `player` + `bests` + `song/list` 三份数据合成一份「拿来就能渲染」
 * 的结构，同时把本地公式算出的 Rating 与落雪返回值逐条对拍。
 *
 * 之所以做成视图模型而不是让前端自己拼：Vela 端请求轮次更贵、算力更弱，
 * 一份预组装结果可以直接复用。
 */

import type {
  FCType,
  FSType,
  LevelIndex,
  MaimaiAliasList,
  MaimaiBests,
  MaimaiGenre,
  MaimaiNotes,
  MaimaiPlayer,
  MaimaiScore,
  MaimaiSong,
  MaimaiSongDifficulty,
  MaimaiSongDifficultyUtage,
  MaimaiSongList,
  MaimaiVersion,
  RateType,
  SongType,
} from '../lxns/types.js';
import { MAIMAI_ASSET_BASE } from '../lxns/types.js';
import { difficultyColor, difficultyName, difficultyShortName, ratingTier } from './constants.js';
import { maxDxScoreFromNotes } from './format.js';
import {
  ACHIEVEMENT_CAP,
  calculateDxRating,
  isAllPerfect,
  maxRatingForLevel,
  normalizeAchievement,
  rateFromAchievement,
  verifyScoreRating,
  type ScoreRatingVerification,
} from './rating.js';

// ── 曲库索引 ────────────────────────────────────────────────────────────

export interface SongIndex {
  songs: Map<number, MaimaiSong>;
  aliases: Map<number, string[]>;
  versions: MaimaiVersion[];
  genres: MaimaiGenre[];
}

/** 建立曲目索引（ID → 曲目、ID → 别名）。 */
export function buildSongIndex(songList: MaimaiSongList, aliasList?: MaimaiAliasList | null): SongIndex {
  const songs = new Map<number, MaimaiSong>();
  for (const song of songList.songs ?? []) songs.set(song.id, song);

  const aliases = new Map<number, string[]>();
  for (const entry of aliasList?.aliases ?? []) {
    if (entry.aliases?.length) aliases.set(entry.song_id, entry.aliases);
  }

  return {
    songs,
    aliases,
    versions: songList.versions ?? [],
    genres: songList.genres ?? [],
  };
}

/**
 * 曲绘 URL。
 *
 * ⚠️ **必须带裁剪参数，并且用 JPG。**
 *
 * 原图是 400×400、347 KB，而列表里显示只有 68px。官方《启动时延优化》明确要求：
 *
 *   > 一般非必要不建议引入在线大图，引入的大图尺寸也不要超过屏幕尺寸，
 *   > 且大小不超过 200kb……或者在线图片里支持 resize 尺寸裁剪
 *
 * 落雪图床支持七牛的 imageView2 语法（实测过：换宽度体积跟着变、换图同样生效）。
 *
 * 格式只能用 **PNG 或 JPG**——Vela 的 image 组件不支持 webp（已跟用户确认过）。
 * 两者实测对比（id=1209）：
 *
 *   96px   PNG 25.1 KB / JPG  3.8 KB
 *   192px  PNG 93.9 KB / JPG 12.8 KB
 *
 * 曲绘是不透明的方图，没有透明通道需求，所以用 JPG：
 * **原图 347 KB → 3.8 KB，缩小 91 倍。**
 *
 * @param size 目标宽度（px）。建议取显示尺寸的 1.5 倍左右，兼顾清晰度和体积。
 */
export function jacketUrl(songId: number, size = 96): string {
  return `${MAIMAI_ASSET_BASE}/jacket/${songId}.png?imageView2/1/w/${size}/format/jpg`;
}

/**
 * 通用资源图 URL（头像 / 铭牌 / 边框等）。
 *
 * 和曲绘一样必须裁剪 + 用 JPG：原图都是几百 KB 的 PNG，
 * 而手表上只显示几十像素。格式限制见 `jacketUrl` 的说明（不支持 webp）。
 */
export function assetImageUrl(path: string, size = 96): string {
  return `${MAIMAI_ASSET_BASE}/${path}.png?imageView2/1/w/${size}/format/jpg`;
}

/** 音频 URL。 */
export function musicUrl(songId: number): string {
  return `${MAIMAI_ASSET_BASE}/music/${songId}.mp3`;
}

/**
 * 在曲目中定位谱面难点。
 *
 * 宴会场曲目的 `level_index` 恒为 0，无法唯一定位，因此额外用难度标级做二次匹配；
 * 仍无法定位时退回该类型的首张谱面（并记入 warning）。
 */
export function findDifficulty(
  song: MaimaiSong,
  type: SongType,
  levelIndex: LevelIndex,
  levelLabel?: string | undefined,
): MaimaiSongDifficulty | MaimaiSongDifficultyUtage | undefined {
  if (type === 'utage') {
    const utage = song.difficulties.utage ?? [];
    const byLevel = levelLabel ? utage.find((chart) => chart.level === levelLabel) : undefined;
    if (byLevel) return byLevel;
    return utage.find((chart) => chart.difficulty === levelIndex) ?? utage[0];
  }
  const list = type === 'dx' ? song.difficulties.dx ?? [] : song.difficulties.standard ?? [];
  return list.find((chart) => chart.difficulty === levelIndex) ?? list[0];
}

// ── 视图模型 ────────────────────────────────────────────────────────────

/**
 * 版本号 → 版本名。
 *
 * ⚠️ 两个字段的粒度不一样：曲目里是 `21007` 这种细粒度值（末三位是修订号），
 * 而 versions 表里是 `21000` 这样的千位步长。所以先按原值查，
 * 查不到再**按千位取整**兜底——直接用原值查会全部落空。
 *
 * 放在 core 里而不是各端各写一遍：服务端的搜索接口和这里的 B50 都要用，
 * 这份取整规则踩过一次坑，不该有第二份实现。
 */
export function versionTitleOf(
  versions: readonly MaimaiVersion[] | undefined,
  version: number | null | undefined,
): string | null {
  if (!versions || version === null || version === undefined) return null;
  const exact = versions.find((item) => item.version === version);
  if (exact) return exact.title;
  const coarse = Math.floor(version / 1000) * 1000;
  return versions.find((item) => item.version === coarse)?.title ?? null;
}

export interface B50Entry {
  /** 原始成绩，保留以便后续扩展。 */
  score: MaimaiScore;

  songId: number;
  title: string;
  artist: string;
  genre: string;
  bpm: number | null;
  songVersion: number | null;
  /** 版本名（如「舞萌DX 2021」）。查不到时为 null。 */
  songVersionTitle: string | null;
  jacketUrl: string;

  /** 曲目别名（落雪别名系统）。 */
  aliases: string[];

  type: SongType;
  levelIndex: number;
  difficulty: string;
  difficultyShort: string;
  difficultyColor: string;
  /** 难度标级，如 `14+`。 */
  level: string;
  /** 谱面定数。 */
  levelValue: number | null;
  noteDesigner: string | null;
  notes: MaimaiNotes | null;
  /** 理论 DX 分数上限。 */
  maxDxScore: number | null;

  achievements: number;
  rate: RateType;
  dxScore: number;
  dxStar: number;
  fc: FCType | null;
  fs: FSType | null;

  /** 落雪给出的单曲 Rating（已取整）；缺失为 null。 */
  rating: number | null;
  /** 本地公式算出的单曲 Rating。 */
  computedRating: number | null;
  /** 该谱面 AP+ 满分的理论单曲 Rating。 */
  maxRating: number | null;
  /** 距离该谱面理论满分还差多少分。 */
  headroom: number | null;
  /** 与落雪对拍结果。 */
  verification: ScoreRatingVerification | null;

  lastPlayedTime: string | null;
}

export interface PlayerView {
  name: string;
  rating: number;
  friendCode: number | null;
  courseRank: number;
  classRank: number;
  star: number;
  tier: { minimum: number; label: string; color: string };
  trophyName: string | null;
  trophyColor: string | null;
  iconUrl: string | null;
  plateUrl: string | null;
  frameUrl: string | null;
  uploadTime: string | null;
}

export interface LevelBucket {
  /** 定数，如 `14.0`。 */
  levelValue: number;
  count: number;
  /** 该定数下的平均达成率。 */
  averageAchievement: number;
}

export interface B50Stats {
  /** 官方总 DX Rating = standard_total + dx_total。 */
  total: number;
  standardTotal: number;
  dxTotal: number;

  /** 本地公式合计（用于对拍）。 */
  computedTotal: number;
  computedStandardTotal: number;
  computedDxTotal: number;

  /** 本地公式与官方合计的差值。 */
  computedDelta: number;
  /** 旧曲小计的差值（本地 - 官方）。 */
  computedStandardDelta: number;
  /** 新曲小计的差值（本地 - 官方）。 */
  computedDxDelta: number;

  chartCount: number;
  /** 旧曲（standard）条目数。 */
  standardCount: number;
  /** 新曲（dx）条目数。 */
  dxCount: number;
  averageLevelValue: number;
  maxLevelValue: number;
  averageAchievement: number;
  maxAchievement: number;
  minAchievement: number;

  /** fc 为 ap/app 的数量。 */
  allPerfectCount: number;
  /** 有 fc 记录的数量。 */
  fullComboCount: number;
  /** 有 fs 记录的数量。 */
  fullSyncCount: number;

  /** 按定数分布。 */
  levelBuckets: LevelBucket[];

  /** 各评级数量。 */
  rateCounts: { rate: RateType; count: number }[];

  /** 若当前 50 首全部打到 AP+，总分能到多少。 */
  theoreticalMaxTotal: number;
  /** 距离理论值的差距。 */
  gapToTheoretical: number;
}

export interface SelfCheckSample {
  songId: number;
  title: string;
  difficulty: string;
  levelValue: number;
  achievements: number;
  fc: FCType | null;
  computed: number;
  computedWithoutApBonus: number;
  api: number | null;
}

export interface RatingSelfCheck {
  /** 参与对拍的成绩条数（需要有定数且落雪返回了 dx_rating）。 */
  checked: number;
  matched: number;
  mismatched: number;
  /** 落雪未返回 dx_rating 的条数。 */
  missingApiRating: number;
  /** 忽略 AP 加分时的匹配数。 */
  matchedWithoutApBonus: number;
  /**
   * 落雪的 `dx_rating` 是否包含 AP 加分。
   * `true` 含、`false` 不含、`null` 数据不足以判断。
   */
  includesApBonus: boolean | null;
  samples: SelfCheckSample[];
}

export interface B50View {
  player: PlayerView;
  standard: B50Entry[];
  dx: B50Entry[];
  standardSelections: B50Entry[];
  dxSelections: B50Entry[];
  stats: B50Stats;
  selfCheck: RatingSelfCheck;
  /** 数据层面的问题（缺曲目、缺定数等），不阻断渲染。 */
  warnings: string[];
  generatedAt: string;
}

export interface BuildB50Input {
  player: MaimaiPlayer;
  bests: MaimaiBests;
  index: SongIndex;
  /** 覆盖 player 中的好友码（按 QQ 查询时用）。 */
  friendCode?: number | null;
  /** 生成时间，便于测试注入。 */
  now?: Date;
}

/** 组装完整 B50 视图模型。 */
export function buildB50View(input: BuildB50Input): B50View {
  const { player, bests, index } = input;
  const warnings = new Set<string>();

  const standard = buildEntries(bests.standard ?? [], index, warnings);
  const dx = buildEntries(bests.dx ?? [], index, warnings);
  const standardSelections = buildEntries(bests.standard_selections ?? [], index, warnings);
  const dxSelections = buildEntries(bests.dx_selections ?? [], index, warnings);

  const main = [...standard, ...dx];
  const stats = computeStats(standard, dx, bests);
  const selfCheck = computeSelfCheck(main);

  const playerView: PlayerView = {
    name: player.name ?? '未知玩家',
    rating: player.rating ?? 0,
    friendCode: input.friendCode ?? player.friend_code ?? null,
    courseRank: player.course_rank ?? 0,
    classRank: player.class_rank ?? 0,
    star: player.star ?? 0,
    tier: ratingTier(player.rating ?? 0),
    trophyName: player.trophy?.name ?? null,
    trophyColor: player.trophy?.color ?? null,
    iconUrl: player.icon?.id ? assetImageUrl(`icon/${player.icon.id}`, 96) : null,
    plateUrl: player.name_plate?.id ? assetImageUrl(`plate/${player.name_plate.id}`, 192) : null,
    frameUrl: player.frame?.id ? assetImageUrl(`frame/${player.frame.id}`, 96) : null,
    uploadTime: player.upload_time ?? null,
  };

  return {
    player: playerView,
    standard,
    dx,
    standardSelections,
    dxSelections,
    stats,
    selfCheck,
    warnings: [...warnings],
    generatedAt: (input.now ?? new Date()).toISOString(),
  };
}

function buildEntries(
  scores: MaimaiScore[],
  index: SongIndex,
  warnings: Set<string>,
): B50Entry[] {
  return scores.map((score) => buildEntry(score, index, warnings));
}

function buildEntry(score: MaimaiScore, index: SongIndex, warnings: Set<string>): B50Entry {
  const song = index.songs.get(score.id) ?? null;
  if (!song) {
    warnings.add(`曲目 ${score.id} 不在曲库中（可能是版本不一致或曲库未包含），该条按成绩原始数据展示。`);
  }

  const chart = song ? findDifficulty(song, score.type, score.level_index, score.level) : undefined;
  const levelValue = chart && Number.isFinite(chart.level_value) ? chart.level_value : null;
  if (song && !chart) {
    warnings.add(`曲目「${song.title}」找不到 ${score.type} / 难度 ${score.level_index} 的谱面数据。`);
  }
  if (song && chart && levelValue === null) {
    warnings.add(`曲目「${song.title}」的谱面缺少定数（level_value）。`);
  }

  const notes = normalizeNotes(chart?.notes);
  const achievements = normalizeAchievement(score.achievements);

  const verification =
    levelValue === null
      ? null
      : verifyScoreRating({ ...score, achievements }, levelValue);

  const rating =
    typeof score.dx_rating === 'number' && Number.isFinite(score.dx_rating)
      ? Math.floor(score.dx_rating + 1e-9)
      : null;

  const computedRating = verification ? verification.computed : null;
  const maxRating = levelValue === null ? null : maxRatingForLevel(levelValue);

  return {
    score,
    songId: score.id,
    title: song?.title ?? score.song_name ?? `#${score.id}`,
    artist: song?.artist ?? '',
    genre: song?.genre ?? '',
    bpm: song?.bpm ?? null,
    songVersion: song?.version ?? null,
    songVersionTitle: versionTitleOf(index.versions, song?.version),
    jacketUrl: jacketUrl(score.id),    aliases: index.aliases.get(score.id) ?? [],
    type: score.type,
    levelIndex: score.level_index,
    difficulty: difficultyName(score.level_index),
    difficultyShort: difficultyShortName(score.level_index),
    difficultyColor: difficultyColor(score.level_index),
    level: chart?.level ?? score.level ?? '--',
    levelValue,
    noteDesigner: chart?.note_designer ?? null,
    notes,
    maxDxScore: maxDxScoreFromNotes(notes),
    achievements,
    rate: score.rate ?? rateFromAchievement(achievements),
    dxScore: score.dx_score ?? 0,
    dxStar: score.dx_star ?? 0,
    fc: score.fc ?? null,
    fs: score.fs ?? null,
    rating,
    computedRating,
    maxRating,
    headroom: computedRating !== null && maxRating !== null ? maxRating - computedRating : null,
    verification,
    lastPlayedTime: score.last_played_time ?? score.play_time ?? null,
  };
}

export function normalizeNotes(notes: MaimaiSongDifficulty['notes']): MaimaiNotes | null {
  if (!notes) return null;
  if ('left' in notes || 'right' in notes) {
    // BUDDY 谱面：1P / 2P 物量相加即为整谱物量
    const left = (notes as { left?: MaimaiNotes }).left;
    const right = (notes as { right?: MaimaiNotes }).right;
    return sumNotes([left, right]);
  }
  return notes as MaimaiNotes;
}

function sumNotes(list: (MaimaiNotes | undefined)[]): MaimaiNotes | null {
  const present = list.filter((n): n is MaimaiNotes => Boolean(n));
  if (present.length === 0) return null;
  return present.reduce<MaimaiNotes>(
    (acc, n) => ({
      total: acc.total + n.total,
      tap: acc.tap + n.tap,
      hold: acc.hold + n.hold,
      slide: acc.slide + n.slide,
      touch: acc.touch + n.touch,
      break: acc.break + n.break,
    }),
    { total: 0, tap: 0, hold: 0, slide: 0, touch: 0, break: 0 },
  );
}

/**
 * 汇总统计。
 *
 * ⚠️ 关键口径：落雪的 `standard` / `dx` 两个列表是按**曲子版本**划分的
 * （旧曲 Best 35 / 新曲 Best 15），列表内部同时包含标准谱面与 DX 谱面。
 * 因此小计必须按「来自哪个列表」拆，而不能按 `score.type` 拆——
 * 实测一份真实 B50 的 B35 里有 26 条是 DX 谱面。
 */
function computeStats(standard: B50Entry[], dx: B50Entry[], bests: MaimaiBests): B50Stats {
  const entries = [...standard, ...dx];
  const withLevel = entries.filter((e) => e.levelValue !== null);

  const sum = (list: number[]) => list.reduce((a, b) => a + b, 0);
  const avg = (list: number[]) => (list.length === 0 ? 0 : sum(list) / list.length);
  const ratingsOf = (list: B50Entry[]) =>
    list.filter((e) => e.computedRating !== null).map((e) => e.computedRating as number);

  const computedStandardTotal = sum(ratingsOf(standard));
  const computedDxTotal = sum(ratingsOf(dx));

  /**
   * 合计。**源不给就用本地算的。**
   *
   * 落雪会给 `standard_total` / `dx_total`，直接用即可；
   * 但自建 net 的 `ratingComposition` 里**只有达成率、没有 rating**，
   * 源只能自己按定数算——而源不一定拿得到曲库。
   *
   * 以前写死 `?? 0`，源不给就显示 0 分。现在回退到本地算出来的，
   * 至少数字是对的。对拍（delta）仍然只在源给了合计时才有意义。
   */
  const hasSourceTotals =
    typeof bests.standard_total === 'number' || typeof bests.dx_total === 'number';
  const standardTotal = hasSourceTotals ? (bests.standard_total ?? 0) : computedStandardTotal;
  const dxTotal = hasSourceTotals ? (bests.dx_total ?? 0) : computedDxTotal;
  const total = standardTotal + dxTotal;
  const computedTotal = computedStandardTotal + computedDxTotal;

  const levelValues = withLevel.map((e) => e.levelValue as number);
  const achievements = entries.map((e) => e.achievements);

  const bucketMap = new Map<number, number[]>();
  for (const entry of withLevel) {
    const key = entry.levelValue as number;
    const list = bucketMap.get(key);
    if (list) list.push(entry.achievements);
    else bucketMap.set(key, [entry.achievements]);
  }
  const levelBuckets: LevelBucket[] = [...bucketMap.entries()]
    .map(([levelValue, list]) => ({ levelValue, count: list.length, averageAchievement: avg(list) }))
    .sort((a, b) => b.levelValue - a.levelValue);

  const rateMap = new Map<RateType, number>();
  for (const entry of entries) rateMap.set(entry.rate, (rateMap.get(entry.rate) ?? 0) + 1);
  const rateCounts = [...rateMap.entries()]
    .map(([rate, count]) => ({ rate, count }))
    .sort((a, b) => b.count - a.count);

  const theoreticalMaxTotal = sum(
    entries.filter((e) => e.maxRating !== null).map((e) => e.maxRating as number),
  );

  return {
    total,
    standardTotal,
    dxTotal,
    computedTotal,
    computedStandardTotal,
    computedDxTotal,
    computedDelta: computedTotal - total,
    computedStandardDelta: computedStandardTotal - standardTotal,
    computedDxDelta: computedDxTotal - dxTotal,
    chartCount: entries.length,
    standardCount: standard.length,
    dxCount: dx.length,
    averageLevelValue: avg(levelValues),
    maxLevelValue: levelValues.length ? Math.max(...levelValues) : 0,
    averageAchievement: avg(achievements),
    maxAchievement: achievements.length ? Math.max(...achievements) : 0,
    minAchievement: achievements.length ? Math.min(...achievements) : 0,
    allPerfectCount: entries.filter((e) => isAllPerfect(e.fc)).length,
    fullComboCount: entries.filter((e) => e.fc !== null).length,
    fullSyncCount: entries.filter((e) => e.fs !== null).length,
    levelBuckets,
    rateCounts,
    theoreticalMaxTotal,
    gapToTheoretical: theoreticalMaxTotal - computedTotal,
  };
}

function computeSelfCheck(entries: B50Entry[]): RatingSelfCheck {
  let matched = 0;
  let mismatched = 0;
  let missingApiRating = 0;
  let matchedWithoutApBonus = 0;
  const samples: SelfCheckSample[] = [];

  for (const entry of entries) {
    const verification = entry.verification;
    if (!verification) continue;
    if (verification.api === null) {
      missingApiRating += 1;
      continue;
    }
    if (verification.matches) matched += 1;
    else mismatched += 1;
    if (verification.matchesWithoutApBonus) matchedWithoutApBonus += 1;

    if (!verification.matches && samples.length < 12) {
      samples.push({
        songId: entry.songId,
        title: entry.title,
        difficulty: entry.difficulty,
        levelValue: verification.levelValue,
        achievements: verification.achievement,
        fc: entry.fc,
        computed: verification.computed,
        computedWithoutApBonus: verification.computedWithoutApBonus,
        api: verification.api,
      });
    }
  }

  const checked = matched + mismatched;
  let includesApBonus: boolean | null = null;
  if (checked > 0 && matched !== matchedWithoutApBonus) {
    includesApBonus = matched > matchedWithoutApBonus;
  }

  return {
    checked,
    matched,
    mismatched,
    missingApiRating,
    matchedWithoutApBonus,
    includesApBonus,
    samples,
  };
}

/**
 * 依据当前成绩推算「某首谱面推到目标达成率能拿多少分」。
 * 供推分建议使用。
 */
export function projectRating(entry: B50Entry, targetAchievement: number): number | null {
  if (entry.levelValue === null) return null;
  const allPerfect = targetAchievement >= ACHIEVEMENT_CAP;
  return calculateDxRating(entry.levelValue, Math.min(targetAchievement, ACHIEVEMENT_CAP), { allPerfect });
}
