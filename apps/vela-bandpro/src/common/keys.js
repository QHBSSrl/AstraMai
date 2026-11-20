/**
 * 跨页面共享的 **storage 键**。
 *
 * ── 为什么要有这个文件 ──────────────────────────────────────────────
 *
 * 页面之间传数据全靠 storage（这个 App 一直是这么做的）。
 * 但键是字符串字面量，写在各页面里 —— 只要有一边改了字，
 * 另一边会**静默读不到**：
 *
 *   表现是"没有数据"，但数据明明在；
 *   不会报错，不会崩，只是功能莫名其妙不工作。
 *
 * 这类 bug 我在这几轮里已经埋了两次隐患：
 *   · `plan.ux` 手拼 `b50Cache:<game>:<code>`，而 `b50.ux` 在方法里拼
 *   · `b50.ux` 直接写字符串 `'pushSeed'`，而 `push.ux` 里有个 `SEED_KEY` 常量
 *
 * 现在统一从这里取。**改键只改这一个文件。**
 *
 * ── 约定 ────────────────────────────────────────────────────────────
 *
 * 键名用**动宾式**：`b50Cache` / `b50LastDiff`，注意大小写 ——
 * storage 的键是**区分大小写**的字符串。
 */

/**
 * 某次查询的 B50 缓存。
 *
 * 缓存里是完整的 `B50View`（JSON 字符串），用于：
 *   · 离线时显示上次的成绩
 *   · 「练哪条最划算」读它来算提升空间
 *   · 下次查询时和它做对比
 *
 * ⚠️ `code` 是玩家的好友码或 QQ 号，**不同玩家的缓存必须分开**，
 *    否则查完朋友再查自己会看到朋友的数据。
 */
export function b50CacheKey(game, code) {
  return `b50Cache:${game}:${code}`;
}

/** 缓存的时间戳（毫秒），和 `b50CacheKey` 配套。 */
export function b50CacheAtKey(game, code) {
  return `b50Cache:${game}:${code}:at`;
}

/**
 * 缓存索引，存 `[{key, at}]`。
 *
 * 用来做 LRU 淘汰 —— 一份 view 十几 KB，不淘汰会把手表存储写满。
 */
export const B50_CACHE_INDEX_KEY = 'b50CacheIndex';

/**
 * 最近一次的成绩对比结果（JSON 字符串）。
 *
 * 只存**最后一次**，不分游戏、不分查询目标 ——
 * 对比页回答的是"我刚才那次查询比上次多了什么"。
 */
export const B50_DIFF_KEY = 'b50LastDiff';

/**
 * 从 B50 列表进推分页时带过去的种子（JSON 字符串）。
 *
 * 内容是 `{ title, levelValue, achievement, rating }`，
 * 推分页据此初始化定数和当前达成率 —— 省掉在手表上打字的麻烦。
 */
export const PUSH_SEED_KEY = 'pushSeed';

/** 上次查询的目标（好友码 / QQ 号）。 */
export const QUERY_VALUE_KEY = 'queryValue';

/** 上次查询用的是哪种目标（`friendCode` / `qq` / `username`）。 */
export const QUERY_KIND_KEY = 'queryKind';

/** 当前选中的游戏 id（`maimai` / `chunithm` / `phigros` / `osu`）。 */
export const CURRENT_GAME_KEY = 'currentGame';

export default {
  b50CacheKey,
  b50CacheAtKey,
  B50_CACHE_INDEX_KEY,
  B50_DIFF_KEY,
  PUSH_SEED_KEY,
  QUERY_VALUE_KEY,
  QUERY_KIND_KEY,
  CURRENT_GAME_KEY,
};
