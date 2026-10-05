/**
 * 展示层格式化工具。纯函数，无依赖，浏览器与 Vela 通用。
 */

/** 千分位整数。 */
export function formatInt(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '--';
  return Math.round(value).toLocaleString('en-US');
}

/** 达成率：固定 4 位小数并带百分号。 */
export function formatAchievement(achievement: number | null | undefined): string {
  if (achievement === null || achievement === undefined || !Number.isFinite(achievement)) return '--';
  return `${achievement.toFixed(4)}%`;
}

/** 达成率（去掉多余的尾随 0，用于紧凑场景）。 */
export function formatAchievementShort(achievement: number | null | undefined): string {
  if (achievement === null || achievement === undefined || !Number.isFinite(achievement)) return '--';
  return `${achievement.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')}%`;
}

/** 定数：一位小数。 */
export function formatLevelValue(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '--';
  return value.toFixed(1);
}

/** 两位小数（用于平均值等）。 */
export function formatFixed(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '--';
  return value.toFixed(digits);
}

/** DX 分数：`dx / max`。 */
export function formatDxScore(dxScore: number | null | undefined, max?: number | null): string {
  if (dxScore === null || dxScore === undefined || !Number.isFinite(dxScore)) return '--';
  if (max === null || max === undefined || !Number.isFinite(max)) return formatInt(dxScore);
  return `${formatInt(dxScore)} / ${formatInt(max)}`;
}

/**
 * UTC 时间字符串 → 本地时区可读文本。
 * 落雪返回 `2024-01-01T00:00:00Z` 形式，代表北京时间当日 8:00。
 */
export function formatUtcToLocal(
  iso: string | null | undefined,
  options: { withTime?: boolean } = {},
): string {
  if (!iso) return '--';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  const ymd = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  if (options.withTime === false) return ymd;
  return `${ymd} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 相对时间：`3 天前`。 */
export function formatRelative(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return '--';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const diffMs = now.getTime() - date.getTime();
  if (diffMs < 0) return '刚刚';
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} 个月前`;
  return `${Math.floor(months / 12)} 年前`;
}

/** 带符号的差值显示（如 `+12` / `-3`）。 */
export function formatDelta(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '--';
  const rounded = Math.round(value);
  return rounded > 0 ? `+${formatInt(rounded)}` : formatInt(rounded);
}

/** 截断过长文本。 */
export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * 由谱面物量计算理论 DX 分数上限。
 * 规则：每 Note 3 分；BREAK 额外按 CRITICAL PERFECT 计 2 分（即 BREAK 每颗 5 分）。
 */
export function maxDxScoreFromNotes(notes: { total: number; break: number } | null | undefined): number | null {
  if (!notes || !Number.isFinite(notes.total)) return null;
  return notes.total * 3 + notes.break * 2;
}

/** DX 分数达成率（0–1）。 */
export function dxScoreRatio(
  dxScore: number | null | undefined,
  max: number | null | undefined,
): number | null {
  if (dxScore === null || dxScore === undefined || !max) return null;
  return dxScore / max;
}
