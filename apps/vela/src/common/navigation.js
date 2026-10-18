/**
 * 导航辅助。
 *
 * 为什么需要显式的返回按钮：手表上没有可见的返回入口，用户得先知道
 * 「从屏幕边缘侧滑」这个**隐藏手势**才能回去。不知道的人会到处找按钮，
 * 找不到就只能大退应用重进——而模拟器上干脆连侧滑手势都没有。
 *
 * 做成普通模块而不是自定义组件：组件在这套工具链上踩过坑（见 README），
 * 而这里只需要两个函数，没必要引入 ViewModel 开销。
 *
 * `@system.router` 延迟到真正用到时才 require：
 * 平台模块一旦取不到，静态 import 会让整个页面模块初始化失败。
 */

let routerModule;

export function getRouter() {
  if (routerModule !== undefined) return routerModule;
  try {
    // eslint-disable-next-line global-require
    routerModule = require('@system.router') || null;
  } catch (error) {
    console.warn('[AstraMai] @system.router 不可用：', error);
    routerModule = null;
  }
  return routerModule;
}

/**
 * 返回上一页。
 *
 * `back()` 在「没有上一页」时可能失败（比如页面被直接打开），
 * 所以兜底 replace 到首页——总比把用户困在页面上强。
 */
/**
 * 上一次成功返回的时间，用于防抖。
 *
 * 连点两下返回会 pop 两次——直接退回两级，用户会觉得「返回键抽风」。
 * 700ms 足够挡住手抖，又不影响正常连续操作。
 */
let lastBackAt = 0;
const BACK_DEBOUNCE_MS = 700;

export function goBack(fallbackUri = '/') {
  const router = getRouter();
  if (!router) return false;

  // 防抖：短时间内重复调用视为误触
  const now = Date.now();
  if (now - lastBackAt < BACK_DEBOUNCE_MS) return false;

  /*
   * ⚠️ **不能靠 try/catch 判断「有没有上一页」。**
   *
   * `router.back()` 在没有上一页时**不抛错**，只是什么都不做——
   * 所以原来的兜底 replace 永远不会触发，用户会卡在页面上。
   *
   * 官方提供了 `router.getLength()`（页面栈数量），用它判断：
   *   栈深 > 1 → 有上一页，back
   *   栈深 = 1 → 自己是根页，replace 到 fallback
   */
  let depth = 2; // 拿不到就按「有上一页」处理，行为与旧版一致
  try {
    if (typeof router.getLength === 'function') {
      const length = router.getLength();
      if (typeof length === 'number' && length > 0) depth = length;
    }
  } catch (error) {
    console.warn('[AstraMai] getLength 不可用，按有上一页处理：', error);
  }

  lastBackAt = now;

  if (depth > 1 && typeof router.back === 'function') {
    try {
      router.back();
      return true;
    } catch (error) {
      console.warn('[AstraMai] back 失败，改跳兜底页：', error);
    }
  }

  try {
    if (typeof router.replace === 'function') {
      router.replace({ uri: fallbackUri });
      return true;
    }
  } catch (error) {
    console.error('[AstraMai] replace 也失败了：', error);
  }
  return false;
}

/** 跳转到某个页面。 */
export function push(uri) {
  const router = getRouter();
  if (!router) return false;
  try {
    router.push({ uri });
    return true;
  } catch (error) {
    console.warn('[AstraMai] 跳转失败：', error);
    return false;
  }
}
