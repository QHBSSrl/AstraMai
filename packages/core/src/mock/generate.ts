/**
 * 模拟数据生成器。
 *
 * 用途：在没有开发者密钥、或离线演示时，凭真实曲库造出一份可信的 B50，
 * 让前端与计算逻辑可以独立开发和验证。
 *
 * 设计约束：
 * - 确定性：同一 seed 必须产出完全一致的结果，便于回归对比。
 * - 自洽：`dx_rating`、`standard_total`、`dx_total` 都按官方公式生成，
 *   因此公式自检在 mock 模式下必须 100% 通过；一旦不通过，说明公式实现被改坏了。
 */

import type {
  FCType,
  FSType,
  LevelIndex,
  MaimaiBests,
  MaimaiPlayer,
  MaimaiScore,
  MaimaiSong,
  MaimaiSongDifficulty,
  MaimaiSongList,
  MaimaiGenre,
} from '../lxns/types.js';
import { dxRatingCoefficient, normalizeAchievement, rateFromAchievement } from '../maimai/rating.js';

/** mulberry32：小巧且分布良好的确定性伪随机数发生器。 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface MockB50Options {
  /** 随机种子，默认 20240101。 */
  seed?: number;
  /** 好友码。 */
  friendCode?: number;
  /** 玩家名。 */
  name?: string;
  /** 目标 DX Rating 量级，用于调整成绩水平，默认 15000。 */
  targetRating?: number;
  /** 直接指定玩家 DX Rating；缺省时用 targetRating。 */
  rating?: number;
  /** 是否把 AP 加分计入 `dx_rating`（对齐官方公式）。默认 true。 */
  includeApBonus?: boolean;
  /** 用于生成「同步时间」的当前时刻，便于测试注入。 */
  now?: Date;
}

/** 生成模拟玩家信息。 */
export function createMockPlayer(options: MockB50Options = {}): MaimaiPlayer {
  const seed = options.seed ?? 20240101;
  const rand = mulberry32(seed);
  const now = options.now ?? new Date();
  // 模拟「两天半前刚同步过」，比固定写死一个日期更像真实场景
  const uploadTime = new Date(now.getTime() - 2.5 * 24 * 60 * 60 * 1000);

  return {
    name: options.name ?? 'Ａｓｔｒａ',
    rating: options.rating ?? options.targetRating ?? 15000,
    friend_code: options.friendCode ?? 888888888888888,
    course_rank: Math.floor(rand() * 20),
    class_rank: Math.floor(rand() * 15),
    star: Math.floor(rand() * 300),
    trophy: { id: 300022, name: '理论值', genre: '', color: 'rainbow' },
    icon: { id: 200201, name: '', genre: '' },
    name_plate: { id: 200201, name: '', genre: '' },
    frame: { id: 300101, name: '', genre: '' },
    upload_time: uploadTime.toISOString(),
  };
}

interface Candidate {
  song: MaimaiSong;
  chart: MaimaiSongDifficulty;
  type: 'standard' | 'dx';
}

/** 从曲库中筛出可用于模拟的候选谱面。 */
function collectCandidates(songList: MaimaiSongList, minLevel: number, maxLevel: number): Candidate[] {
  const out: Candidate[] = [];
  for (const song of songList.songs ?? []) {
    if (song.disabled) continue;
    if (song.id > 100000) continue; // 宴会场曲目不参与 Rating
    for (const chart of song.difficulties?.standard ?? []) {
      if (isPlayable(chart, minLevel, maxLevel)) out.push({ song, chart, type: 'standard' });
    }
    for (const chart of song.difficulties?.dx ?? []) {
      if (isPlayable(chart, minLevel, maxLevel)) out.push({ song, chart, type: 'dx' });
    }
  }
  return out;
}

function isPlayable(chart: MaimaiSongDifficulty, minLevel: number, maxLevel: number): boolean {
  const value = chart.level_value;
  return (
    Number.isFinite(value) &&
    value >= minLevel &&
    value <= maxLevel &&
    (chart.difficulty === 3 || chart.difficulty === 4)
  );
}

/**
 * 依目标 Rating 决定「成绩水平」。
 *
 * 标定依据：一份 15000 分的 B50，平均每首约 300 分，对应「定数 14 上下、达成率 99.5%~100.5%」。
 * 目标越高，定数窗口与达成率基准同步上移。
 */
function levelWindow(targetRating: number): { minLevel: number; maxLevel: number; baseAch: number } {
  const maxLevel = Math.min(15.0, Math.max(11.0, targetRating / 1000 - 0.5));
  return {
    minLevel: Math.max(9.0, maxLevel - 1.6),
    maxLevel,
    baseAch: Math.min(100.3, Math.max(97.5, 99.0 + (targetRating - 15000) / 2500)),
  };
}

/**
 * 生成模拟 Best 50。
 *
 * 选出成绩最好的 35 条 standard 与 15 条 dx（按算出的 Rating 排序），
 * 与真实 `/bests` 的语义保持一致。
 */
export function createMockBests(songList: MaimaiSongList, options: MockB50Options = {}): MaimaiBests {
  const seed = options.seed ?? 20240101;
  const rand = mulberry32(seed ^ 0x9e3779b9);
  const targetRating = options.targetRating ?? 15000;
  const includeApBonus = options.includeApBonus ?? true;
  const { minLevel, maxLevel, baseAch } = levelWindow(targetRating);

  let candidates = collectCandidates(songList, minLevel, maxLevel);
  if (candidates.length < 80) candidates = collectCandidates(songList, 9.0, 15.0);
  if (candidates.length === 0) {
    throw new Error('曲库中没有可用于生成模拟成绩的谱面。');
  }

  // 洗牌，避免同一首曲子的多张谱面扎堆
  const shuffled = [...candidates];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    const a = shuffled[i]!;
    const b = shuffled[j]!;
    shuffled[i] = b;
    shuffled[j] = a;
  }

  const scored: { score: MaimaiScore; rating: number }[] = [];
  const midLevel = (minLevel + maxLevel) / 2;
  for (const candidate of shuffled) {
    const score = makeScore(candidate, rand, baseAch, midLevel, includeApBonus);
    if (score === null) continue;
    scored.push({ score, rating: Math.floor((score.dx_rating ?? 0) + 1e-9) });
  }

  // 每首曲目最多取 2 条进入 B50（贴近真实：B50 允许同曲多谱）
  const standard: { score: MaimaiScore; rating: number }[] = [];
  const dx: { score: MaimaiScore; rating: number }[] = [];
  const usage = new Map<number, number>();

  scored.sort((a, b) => b.rating - a.rating);
  for (const item of scored) {
    const used = usage.get(item.score.id) ?? 0;
    if (used >= 2) continue;
    const bucket = item.score.type === 'dx' ? dx : standard;
    const limit = item.score.type === 'dx' ? 15 : 35;
    if (bucket.length >= limit) continue;
    bucket.push(item);
    usage.set(item.score.id, used + 1);
  }

  const standardScores = standard.map((s) => s.score);
  const dxScores = dx.map((s) => s.score);

  return {
    standard_total: sum(standard.map((s) => s.rating)),
    dx_total: sum(dx.map((s) => s.rating)),
    standard: standardScores,
    dx: dxScores,
    standard_selections: pickSelections(scored, standardScores),
    dx_selections: pickSelections(scored, dxScores),
  };
}

function pickSelections(
  scored: { score: MaimaiScore; rating: number }[],
  chosen: MaimaiScore[],
): MaimaiScore[] {
  const chosenKeys = new Set(chosen.map((s) => `${s.id}-${s.type}-${s.level_index}`));
  return scored
    .filter((item) => !chosenKeys.has(`${item.score.id}-${item.score.type}-${item.score.level_index}`))
    .slice(0, 10)
    .map((item) => item.score);
}

function makeScore(
  candidate: Candidate,
  rand: () => number,
  baseAch: number,
  midLevel: number,
  includeApBonus: boolean,
): MaimaiScore | null {
  const { song, chart, type } = candidate;
  const levelValue = chart.level_value;
  if (!Number.isFinite(levelValue)) return null;

  // 定数越高越难打：相对窗口中枢每高 0.1 定数，期望达成率下降约 0.06%
  const penalty = (levelValue - midLevel) * 0.6;
  const jitter = (rand() - 0.5) * 0.9;
  // 少量「打得很好的」成绩把达成率推过 100.5%，用于覆盖 AP / AP+ 这条路径
  const excellent = rand() < 0.06 ? 0.9 + rand() * 0.5 : 0;

  let achievements = baseAch - penalty + jitter + excellent;
  achievements = Math.min(101.0, Math.max(85, achievements));
  achievements = Math.round(achievements * 10_000) / 10_000;

  // ALL PERFECT 的门槛是 100.5%；AP+ 则是 101.0000% 满分
  const allPerfect = achievements >= 100.5;
  const fc = pickFc(achievements, rand);
  const fs = rand() < 0.35 ? pickFs(rand) : null;

  const percent = Math.min(normalizeAchievement(achievements), 100.5);
  const raw = levelValue * (percent / 100) * dxRatingCoefficient(percent);
  const dxRating = includeApBonus && (fc === 'ap' || fc === 'app') ? raw + 1 : raw;

  const noteCount = chart.notes && 'total' in chart.notes ? (chart.notes as { total: number }).total : 900;
  const breakCount = chart.notes && 'break' in chart.notes ? (chart.notes as { break: number }).break : 40;
  const maxDxScore = noteCount * 3 + breakCount * 2;
  const dxScore = Math.round(maxDxScore * (0.9 + rand() * 0.099));

  return {
    id: song.id,
    song_name: song.title,
    level: chart.level,
    level_index: chart.difficulty as LevelIndex,
    achievements,
    fc,
    fs,
    dx_score: dxScore,
    dx_star: starFromRatio(dxScore / maxDxScore),
    dx_rating: dxRating,
    rate: rateFromAchievement(achievements),
    type,
    play_time: null,
    upload_time: new Date(Date.UTC(2024, 0, 1)).toISOString(),
    last_played_time: new Date(Date.UTC(2023, 11, 20 + Math.floor(rand() * 10))).toISOString(),
  };
}

/** 依达成率给出 FC 档位：AP+ 必须是 101.0000%，AP 门槛是 100.5%。 */
function pickFc(achievements: number, rand: () => number): FCType | null {
  if (achievements >= 100.5) return achievements >= 101 ? 'app' : 'ap';
  if (achievements >= 100.0) return 'fcp';
  if (achievements >= 98.5) return rand() < 0.5 ? 'fc' : 'fcp';
  if (rand() < 0.4) return 'fc';
  return null;
}

function pickFs(rand: () => number): FSType {
  const roll = rand();
  if (roll < 0.05) return 'fsdp';
  if (roll < 0.15) return 'fsd';
  if (roll < 0.4) return 'fsp';
  if (roll < 0.75) return 'fs';
  return 'sync';
}

/** DX 分数 → 星级（0–5）。 */
function starFromRatio(ratio: number): number {
  if (ratio >= 1) return 5;
  if (ratio >= 0.95) return 4;
  if (ratio >= 0.9) return 3;
  if (ratio >= 0.8) return 2;
  if (ratio >= 0.7) return 1;
  return 0;
}

function sum(list: number[]): number {
  return list.reduce((a, b) => a + b, 0);
}

/**
 * 完全离线时使用的最小曲库。
 * 结构真实，但曲目是编造的——仅用于让 UI 在没有网络时也能跑起来。
 */
export function createSyntheticSongList(count = 60): MaimaiSongList {
  const genres: MaimaiGenre[] = [
    { id: 1, title: '流行&动漫', genre: 'POPS＆アニメ' },
    { id: 2, title: 'niconico&VOCALOID', genre: 'niconico＆ボーカロイド' },
    { id: 3, title: '东方Project', genre: '東方Project' },
  ];
  const songs: MaimaiSong[] = [];
  const titles = [
    'Astra', 'Nebula', 'Photon', 'Quasar', 'Vertex', 'Halo', 'Zenith', 'Nova',
    'Lumen', 'Orbit', 'Pulsar', 'Cinder', 'Drift', 'Ember', 'Flux', 'Glacier',
  ];
  for (let i = 0; i < count; i += 1) {
    const id = 10_000 + i;
    const base = 11 + (i % 9) * 0.45;
    const levelValue = Math.round(base * 10) / 10;
    const level = levelValue >= 14.7 ? '15' : levelValue >= 13.7 ? '14' : levelValue >= 12.7 ? '13+' : '13';
    songs.push({
      id,
      title: `${titles[i % titles.length]} ${Math.floor(i / titles.length) + 1}`,
      artist: 'AstraMai Mock',
      genre: 'maimai',
      bpm: 120 + ((i * 7) % 100),
      version: 23_000 + (i % 5) * 500,
      difficulties: {
        standard: [0, 1, 2, 3, 4].map((difficulty) => ({
          type: 'standard' as const,
          difficulty: difficulty as LevelIndex,
          level: difficulty === 4 ? level : String(Math.max(1, levelValue - (4 - difficulty) * 1.5)),
          level_value: Math.max(1, Math.round((levelValue - (4 - difficulty) * 1.5) * 10) / 10),
          note_designer: 'Mock',
          version: 23_000,
          notes: {
            total: 500 + difficulty * 180,
            tap: 350 + difficulty * 120,
            hold: 60 + difficulty * 15,
            slide: 50 + difficulty * 25,
            touch: 20 + difficulty * 10,
            break: 15 + difficulty * 6,
          },
        })),
        dx: [0, 1, 2, 3, 4].map((difficulty) => ({
          type: 'dx' as const,
          difficulty: difficulty as LevelIndex,
          level: difficulty === 4 ? level : String(Math.max(1, levelValue - (4 - difficulty) * 1.5)),
          level_value: Math.max(1, Math.round((levelValue - (4 - difficulty) * 1.5) * 10) / 10),
          note_designer: 'Mock',
          version: 23_000,
          notes: {
            total: 520 + difficulty * 190,
            tap: 360 + difficulty * 130,
            hold: 55 + difficulty * 14,
            slide: 60 + difficulty * 26,
            touch: 25 + difficulty * 11,
            break: 18 + difficulty * 7,
          },
        })),
      },
    });
  }
  return {
    songs,
    genres,
    versions: [{ id: 1, title: 'AstraMai Mock Ver.', version: 23_000 }],
  };
}
