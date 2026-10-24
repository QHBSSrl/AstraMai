/**
 * 「上一次的 B50」的本地快照。
 *
 * ── 为什么存在浏览器里 ──────────────────────────────────────────────
 *
 * 对比是「这次 vs 上次」，而上次的数据服务端没有 ——
 * 它只负责回答"你现在多少分"。
 *
 * 手表端是存进 storage 的；web 这边存 localStorage，同一个思路：
 * **比完就把这次存成"上次"**，下次查询就有得比了。
 *
 * ⚠️ 顺序不能反：**先读旧的 → 算对比 → 再存新的**。
 *    反了就是拿新数据和新数据比，永远是"没有变化"。
 *    （这个坑在手表端已经踩过一次，注释抄过来了。）
 */

import type { B50View } from '@astramai/core';

/**
 * 存储键。
 *
 * 用 `astramai:` 前缀，避免和同一个域名下别的东西撞。
 * 带版本号 `v1` —— 以后视图结构变了可以换键，不用写迁移逻辑，
 * 旧数据会自然被忽略。
 */
const STORAGE_KEY = 'astramai:b50:previous:v1';

/**
 * 只留对比用得上的字段。
 *
 * 不存整个 view 的原因：一份 view 十几 KB，而 `diffB50` 只用
 * `player.rating` 和 entries 里的几个字段。
 * localStorage 有 5 MB 上限，虽然够，但没必要塞。
 */
export interface ViewSnapshot {
  player: { rating: number };
  standard: unknown[];
  dx: unknown[];
}

/** 读上一次的快照。没有 / 坏了都返回 null —— 不该因为读缓存让页面挂掉。 */
export function readPreviousView(): B50View | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as B50View;
  } catch (error) {
    // 隐私模式、配额、坏 JSON —— 一律当"没有上次数据"
    console.warn('[AstraMai] 读上一次的成绩失败：', error);
    return null;
  }
}

/** 把这次的结果存成"上一次"。失败不影响主流程。 */
export function writePreviousView(view: B50View): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(view));
  } catch (error) {
    console.warn('[AstraMai] 保存成绩快照失败：', error);
  }
}

/** 清掉快照（设置里可以用，现在没接）。 */
export function clearPreviousView(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 忽略
  }
}
