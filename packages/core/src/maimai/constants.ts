/**
 * 舞萌 DX 领域常量：难度、评级、FC/FS 展示名与配色。
 */

import type { FCType, FSType, LevelIndex, RateType, SongType, TrophyColor } from '../lxns/types.js';

/** 难度全称，下标即 LevelIndex。 */
export const DIFFICULTY_NAMES = ['BASIC', 'ADVANCED', 'EXPERT', 'MASTER', 'Re:MASTER'] as const;

/** 难度缩写，用于紧凑列表。 */
export const DIFFICULTY_SHORT_NAMES = ['BAS', 'ADV', 'EXP', 'MAS', 'ReM'] as const;

/** 难度主题色（与游戏内配色接近）。 */
export const DIFFICULTY_COLORS = ['#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#e5e7eb'] as const;

/** 难度下标的合法集合，用于校验外部输入。 */
export const LEVEL_INDEXES: readonly LevelIndex[] = [0, 1, 2, 3, 4];

export function difficultyName(index: number): string {
  return DIFFICULTY_NAMES[index] ?? `未知(${index})`;
}

export function difficultyShortName(index: number): string {
  return DIFFICULTY_SHORT_NAMES[index] ?? `?${index}`;
}

export function difficultyColor(index: number): string {
  return DIFFICULTY_COLORS[index] ?? '#94a3b8';
}

/** 谱面类型展示名。 */
export const SONG_TYPE_LABELS: Record<SongType, string> = {
  standard: '标准',
  dx: 'DX',
  utage: '宴会场',
};

/** 评级展示名。 */
export const RATE_LABELS: Record<RateType, string> = {
  sssp: 'SSS+',
  sss: 'SSS',
  ssp: 'SS+',
  ss: 'SS',
  sp: 'S+',
  s: 'S',
  aaa: 'AAA',
  aa: 'AA',
  a: 'A',
  bbb: 'BBB',
  bb: 'BB',
  b: 'B',
  c: 'C',
  d: 'D',
};

/** 评级配色。 */
export const RATE_COLORS: Record<RateType, string> = {
  sssp: '#f7d34e',
  sss: '#f7d34e',
  ssp: '#f2a33c',
  ss: '#f2a33c',
  sp: '#7fd1ff',
  s: '#7fd1ff',
  aaa: '#ff7a7a',
  aa: '#ff7a7a',
  a: '#c084fc',
  bbb: '#8ab4f8',
  bb: '#8ab4f8',
  b: '#86efac',
  c: '#86efac',
  d: '#94a3b8',
};

export const FC_LABELS: Record<FCType, string> = {
  app: 'AP+',
  ap: 'AP',
  fcp: 'FC+',
  fc: 'FC',
};

export const FS_LABELS: Record<FSType, string> = {
  fsdp: 'FDX+',
  fsd: 'FDX',
  fsp: 'FS+',
  fs: 'FS',
  sync: 'SYNC',
};

export const TROPHY_COLOR_LABELS: Record<TrophyColor, string> = {
  normal: '普通',
  bronze: '铜',
  silver: '银',
  gold: '金',
  rainbow: '虹',
};

/** 称号颜色 → CSS 颜色。 */
export const TROPHY_COLOR_CSS: Record<TrophyColor, string> = {
  normal: '#e2e8f0',
  bronze: '#d08a56',
  silver: '#cbd5e1',
  gold: '#f5c542',
  rainbow: 'linear-gradient(90deg,#ff5f6d,#ffc371,#7ee8a2,#5bc0eb,#a06bff)',
};

/**
 * DX Rating 段位门槛（仅用于界面展示分段，不影响计算）。
 * 参考社区通行标准与游戏内段位名称。
 */
export const RATING_TIERS: readonly { minimum: number; label: string; color: string }[] = [
  { minimum: 16000, label: '虹極', color: '#a06bff' },
  { minimum: 15000, label: '虹', color: '#f7d34e' },
  { minimum: 14000, label: '金', color: '#f5c542' },
  { minimum: 13000, label: '銀', color: '#cbd5e1' },
  { minimum: 12000, label: '銅', color: '#d08a56' },
  { minimum: 10000, label: '紫', color: '#c084fc' },
  { minimum: 8000, label: '赤', color: '#ff7a7a' },
  { minimum: 6000, label: '青', color: '#7fd1ff' },
  { minimum: 4000, label: '緑', color: '#86efac' },
  { minimum: 2000, label: '白', color: '#e2e8f0' },
  { minimum: 0, label: '灰', color: '#94a3b8' },
];

/** 依据 DX Rating 取得展示用段位。 */
export function ratingTier(rating: number): { minimum: number; label: string; color: string } {
  return RATING_TIERS.find((tier) => rating >= tier.minimum) ?? RATING_TIERS[RATING_TIERS.length - 1]!;
}
