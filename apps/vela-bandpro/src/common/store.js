/**
 * 本地设置读写。
 *
 * ── 两条设计约束，都是踩过坑才定下来的 ─────────────────────────────────
 *
 * 1. **平台模块延迟加载。**
 *    `@system.storage` 用 `require()` 在函数内取，而不是文件顶部的 `import`。
 *    静态 import 会在页面模块初始化时立刻解析平台模块，一旦设备/模拟器不提供它，
 *    **整个页面脚本初始化就会抛错，页面直接空白**——症状是纯黑屏，
 *    日志里一句有意义的报错都没有。延迟到真正要用时再取，失败也只是读不到设置。
 *
 * 2. **内存兜底。**
 *    storage 不可用时，本次运行内仍然有可用的设置值，界面不会因此崩。
 *
 * 见 https://iot.mi.com/vela/quickapp/zh/features/data/storage.html
 */

/** 延迟取 storage 模块；取不到返回 null 并记住结论，不重复尝试。 */
let storageModule;
function getStorage() {
  if (storageModule !== undefined) return storageModule;
  try {
    // eslint-disable-next-line global-require
    storageModule = require('@system.storage') || null;
  } catch (error) {
    console.warn('[AstraMai] @system.storage 不可用，本次运行改用内存存储：', error);
    storageModule = null;
  }
  return storageModule;
}

/** 内存兜底：storage 不可用时至少本次运行内是通的。 */
const memory = new Map();

/** 同步读取（优先内存缓存）。 */
export function readSetting(key, fallback) {
  if (memory.has(key)) return memory.get(key);
  return fallback;
}

/**
 * 异步把存储里的值预热进内存。
 * 页面 `onInit` 里 `warmUp(['serverBase', 'qrInput'])` 一下即可。
 * 永远不 reject——读不到设置不应该让页面挂掉。
 */
export function warmUp(keys) {
  const storage = getStorage();
  if (!storage) return Promise.resolve();

  const tasks = keys.map(
    (key) =>
      new Promise((resolve) => {
        try {
          storage.get({
            key,
            success(value) {
              if (value !== undefined && value !== null && value !== '') memory.set(key, value);
              resolve();
            },
            fail() {
              resolve();
            },
          });
        } catch (error) {
          console.warn('[AstraMai] 读取设置失败：', key, error);
          resolve();
        }
      }),
  );
  return Promise.all(tasks);
}

/** 写入并回填内存缓存。 */
export function writeSetting(key, value) {
  memory.set(key, value);
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.set({ key, value, success() {}, fail() {} });
  } catch (error) {
    console.warn('[AstraMai] 写入设置失败：', key, error);
  }
}

/** 删除。 */
export function clearSetting(key) {
  memory.delete(key);
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.delete({ key, success() {}, fail() {} });
  } catch (error) {
    console.warn('[AstraMai] 删除设置失败：', key, error);
  }
}
