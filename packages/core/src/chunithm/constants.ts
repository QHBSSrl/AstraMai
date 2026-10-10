/**
 * 中二节奏（CHUNITHM）领域常量。
 *
 * ⚠️ 难度档位以**实测数据**为准，不是文档。
 *
 * 文档的 `LevelIndex` 只列了 0–4，但真实曲库里出现了 **5**：
 *
 *   0 BASIC / 1 ADVANCED / 2 EXPERT / 3 MASTER / 4 ULTIMA / 5 WORLD'S END
 *
 * 只看文档会把 WORLD'S END 整档漏掉，UI 上显示成 `#5`。
 * 这是 2026-10 直接请求 `/api/v0/chunithm/song/list` 核对出来的。
 */

/** 已知难度档位的数量（含 WORLD'S END）。 */
export const CHUNITHM_DIFFICULTY_COUNT = 6;

/**
 * 难度简称。
 * 用游戏内通用写法，中文玩家也认这套缩写。
 */
export const CHUNITHM_DIFFICULTY_NAMES: readonly string[] = [
  'BAS',
  'ADV',
  'EXP',
  'MST',
  'ULT',
  'WE',
];

/**
 * 难度配色。
 *
 * 官方配色是：BASIC 绿 / ADVANCED 黄 / EXPERT 红 / MASTER 紫 /
 * ULTIMA **黑** / WORLD'S END 特殊（游戏内是彩虹质感，单色表示不了）。
 *
 * ⚠️ 一处刻意的取舍：**ULTIMA 官方是黑色，而我们的界面是深色底
 * （#070b16），黑色根本看不见**。所以这里用了近白色反显——
 * 牺牲一点"官方一致"，换取"看得见"。如果将来出浅色主题要改回来。
 *
 * WORLD'S END 用金色代表：它是特殊谱面，游戏里没有单一颜色，
 * 挑一个**和其它五档都不撞**的颜色就够了。
 */
export const CHUNITHM_DIFFICULTY_COLORS: readonly string[] = [
  '#7ee081', // BASIC      绿
  '#f5a623', // ADVANCED   黄（偏橙，贴近游戏内）
  '#f2564b', // EXPERT     红
  '#b06fe8', // MASTER     紫
  '#f2f2f2', // ULTIMA     近白（官方黑，深色底上反显）
  '#ffcf4d', // WORLD'S END 金（特殊谱面，单色代表）
];

/** 越界时的兜底颜色。上游加档位时不该显示成透明或崩掉。 */
export const CHUNITHM_UNKNOWN_COLOR = '#9bacd0';

/** 难度名。未知档位返回 `#n` 而不是空白——**看得见比好看重要**。 */
export function chunithmDifficultyName(index: number): string {
  return CHUNITHM_DIFFICULTY_NAMES[index] ?? `#${index}`;
}

/** 难度颜色。未知档位返回中性灰。 */
export function chunithmDifficultyColor(index: number): string {
  return CHUNITHM_DIFFICULTY_COLORS[index] ?? CHUNITHM_UNKNOWN_COLOR;
}

/** CLEAR 类型的中文说明。 */
export const CHUNITHM_CLEAR_LABELS: Record<string, string> = {
  clear: 'CLEAR',
  failed: 'FAILED',
};

/**
 * FULL COMBO 类型。
 *
 * ⚠️ 上游只给 `alljustice` / `fullcombo`，**没有区分 AJ 与 AJC**
 * （文档原话：「AJC 显示为 ALL JUSTICE，需要开发者自行判断」）。
 * 想区分只能额外看判定数，而那不在这个接口里——所以这里如实只显示 ALL JUSTICE。
 */
export const CHUNITHM_FC_LABELS: Record<string, string> = {
  alljustice: 'AJ',
  fullcombo: 'FC',
};

/** FULL CHAIN 类型。`fullchain` 是铂，`fullchain2` 是金。 */
export const CHUNITHM_CHAIN_LABELS: Record<string, string> = {
  fullchain: '铂链',
  fullchain2: '金链',
};

/** 评级显示名（大写）。 */
export const CHUNITHM_RANK_LABELS: Record<string, string> = {
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

/**
 * 单谱面 RKS 式的贡献值？
 *
 * 中二节奏的 Rating 由接口直接给出（`Score.rating` 是浮点数），
 * 和舞萌不同——**不需要我们复刻公式**。
 * 这里只留个说明，免得后来人以为漏了什么。
 */
export const CHUNITHM_RATING_IS_SERVER_SIDE = true;

/** 中二节奏资源根。和舞萌是**不同的命名空间**（maimai 那边放 /maimai/）。 */
export const CHUNITHM_ASSET_BASE = 'https://assets2.lxns.net/chunithm';

/**
 * 中二节奏曲绘 URL。
 *
 * ⚠️ 和舞萌一样必须带裁剪参数，理由完全相同：原图是 300×300、
 * 30–115 KB，而列表里只显示几十像素。官方《启动时延优化》要求
 * 「大图尺寸不要超过屏幕尺寸，且不超过 200 KB」。
 *
 * 实测（2026-10）：
 *   原图             300×300   30.3 KB (id=3)
 *   ?imageView2/1/w/96/format/jpg   3.2 KB
 *
 * 格式同样只能用 **PNG 或 JPG**——Vela 的 image 组件不支持 webp。
 *
 * @param size 目标宽度（px）。
 */
export function chunithmJacketUrl(songId: number, size = 96): string {
  return `${CHUNITHM_ASSET_BASE}/jacket/${songId}.png?imageView2/1/w/${size}/format/jpg`;
}
