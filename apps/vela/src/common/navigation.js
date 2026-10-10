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
export function goBack(fallbackUri = '/') {
  const router = getRouter();
  if (!router) return false;

  try {
    if (typeof router.back === 'function') {
      router.back();
      return true;
    }
    if (typeof router.replace === 'function') {
      router.replace({ uri: fallbackUri });
      return true;
    }
  } catch (error) {
    console.warn('[AstraMai] 返回失败，改跳首页：', error);
    try {
      if (typeof router.replace === 'function') {
        router.replace({ uri: fallbackUri });
        return true;
      }
    } catch (nested) {
      console.error('[AstraMai] 跳首页也失败了：', nested);
    }
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
