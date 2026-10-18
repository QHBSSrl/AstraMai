/**
 * osu! 领域类型。
 *
 * ── 为什么单独一层，不塞进 lxns/ ────────────────────────────────────
 *
 * 和 Phigros 同理：**这是第三个完全不同的平台**。
 *   落雪   —— 舞萌 / 中二（同一个上游，好友码 / QQ 号）
 *   Phigros—— TapTap 扫码登录
 *   osu!   —— 官方 API v2，OAuth2 认证，用户名查询
 *
 * 玩家的标识、成绩的形状、评级的含义全都不一样，硬归一只会把上游的差异
 * 搬到我们这边来。
 *
 * ── 和舞萌最大的区别：没有「B50」这个概念 ───────────────────────────
 *
 * osu! 的核心指标是 **pp**（performance points），成绩列表是「最好的 N 个 play」，
 * 每个 play 有自己的 pp，按权重递减累加成总 pp。
 *
 * 所以这里的 `OsuBests` 不是 `MaimaiBests`（那个有 `standard_total` / `dx_total`），
 * 而是一个按 pp 排序的列表 + 总分。
 */

/**
 * osu! 的四个玩法。
 *
 * 官方叫 `Ruleset`（旧文档里的 `GameMode`）。用官方名，避免和我们的 `mode` 混。
 */
export type OsuRuleset = 'osu' | 'taiko' | 'fruits' | 'mania';

export const OSU_RULESETS: readonly OsuRuleset[] = ['osu', 'taiko', 'fruits', 'mania'];

/** osu! 的人类可读名。 */
export const OSU_RULESET_LABEL: Record<OsuRuleset, string> = {
  osu: 'osu!standard',
  taiko: 'osu!taiko',
  fruits: 'osu!catch',
  mania: 'osu!mania',
};

export interface OsuPlayer {
  id: number;
  username: string;
  /** 全球排名。**可能是 null**——没打过这个玩法的人没有排名。 */
  globalRank: number | null;
  countryRank: number | null;
  /** 两位国家代码，如 `CN`。 */
  countryCode: string;
  /** performance points。 */
  pp: number;
  /** 准确率，0–1 的小数（不是百分数）。 */
  accuracy: number;
  playCount: number;
  ruleset: OsuRuleset;
}

export interface OsuScore {
  /**
   * 这次成绩的 pp。
   *
   * ⚠️ **可能是 0 或 null**——未进榜的谱面不算 pp。
   * 上游给 null 时这里归一成 0。
   */
  pp: number;
  /** 加权后的贡献（`weightPercent / 100 * pp`）。总 pp 就是它求和。 */
  weightedPp: number;
  /** 权重百分比。第一名 100，往后递减（约 0.95 的等比）。 */
  weightPercent: number;
  /** 准确率，0–1。 */
  accuracy: number;
  /** 评级字母：`XH` `X` `SH` `S` `A` … */
  rank: string;
  /** MOD 缩写列表，如 `['HD', 'HR']`。 */
  mods: string[];
  /** 原始总分（游戏内的分数，不是 pp）。 */
  score: number;
  maxCombo: number;

  /** 谱面 ID。 */
  beatmapId: number;
  /** 难度名，如 `Insane`。 */
  version: string;
  /** 星数（难度评级）。 */
  starRating: number;
  /** `艺术家 - 标题`。 */
  title: string;
  /** 曲绘。可能是空字符串（上游不给时）。 */
  coverUrl: string;
}

export interface OsuBests {
  player: OsuPlayer;
  /** 按 pp 降序，**最多 100 条**（上游上限）。 */
  scores: OsuScore[];
  /** 总 pp——就是 player.pp，但单独放一份方便展示。 */
  totalPp: number;
  /**
   * 这份数据是「前 N 名」而不是完整的 rating 构成。
   *
   * 舞萌的 B50 是**全部**成绩里按规则挑 50 个，算出来就是 rating。
   * osu! 的 pp 是**所有** play 加权求和（不截断到 50），
   * 所以这里列出的前 N 名之和 ≤ 总 pp。展示时要说清楚。
   */
  truncated: boolean;
}

/** 把 0–1 的准确率格式化成 `98.76%`。 */
export function formatOsuAccuracy(accuracy: number): string {
  if (!Number.isFinite(accuracy)) return '—';
  return `${(accuracy * 100).toFixed(2)}%`;
}

/**
 * pp 的展示格式。
 *
 * 上万之后带一位小数就没意义了（`12345.6pp` 读起来费劲），
 * 所以 ≥ 10000 取整。
 */
export function formatOsuPp(pp: number): string {
  if (!Number.isFinite(pp)) return '—';
  if (pp >= 10_000) return `${Math.round(pp)}`;
  if (pp >= 1_000) return pp.toFixed(1);
  return pp.toFixed(2);
}

/** 全球排名带千分位。没有排名时给 `—`。 */
export function formatOsuRank(rank: number | null): string {
  if (rank === null || !Number.isFinite(rank)) return '—';
  return `#${Math.round(rank).toLocaleString('en-US')}`;
}
