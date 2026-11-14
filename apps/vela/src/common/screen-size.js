/**
 * 屏幕宽度 —— 用来算字号倍率。
 *
 * ── 为什么需要它 ────────────────────────────────────────────────────
 *
 * Vela 的 `designWidth` 是 466，所有 CSS px 都按
 * `物理宽 / designWidth` 缩放。
 *
 * 手环 9 Pro 只有 336 宽 → 缩放比 0.72 → 22px 的字实际只有 15.9 物理像素。
 * 手表 466 宽 → 缩放比 1.0 → 同样的 22px 就是 22 物理像素。
 *
 * **手环上的字天生比手表小 28%** —— 这就是「看着费劲」的真正原因，
 * 不是字号写小了。
 *
 * ── 做法 ────────────────────────────────────────────────────────────
 *
 * 不写死倍率，而是按屏幕宽度反推：
 *
 *   scale = designWidth / 实际逻辑宽度
 *
 *   336 宽（手环 9 Pro） → 466 / 336 ≈ 1.39
 *   466 宽（手表）        → 1.0
 *
 * 取不到宽度就返回 1 —— 宁可不变，也不要算错把字撑爆。
 */

/** 设计稿宽度，和 manifest.json 的 designWidth 保持一致。 */
const DESIGN_WIDTH = 466;

/** 只放大不缩小 —— 比设计稿还宽的设备不需要把字变小。 */
const MIN_SCALE = 1;

/** 上限。再大就会挤爆列表行，宁可截断也不要版面崩掉。 */
const MAX_SCALE = 1.5;

/** 缓存 —— 屏幕宽度不会变，别每次渲染都去问一次。 */
let cachedWidth = null;

/**
 * 拿屏幕逻辑宽度。
 *
 * 依次试几种取法，都拿不到就返回 null。
 * ⚠️ 字段名没在真机上逐个验证过，所以做了多重兜底。
 */
function screenWidth() {
  if (cachedWidth !== null) return cachedWidth;

  try {
    // eslint-disable-next-line global-require
    const device = require('@system.device');
    if (device && typeof device.getInfo === 'function') {
      let info = null;
      device.getInfo({
        success: (data) => {
          info = data;
        },
      });
      if (info) {
        const w =
          info.screenWidth
          || info.windowWidth
          || info.width
          || 0;
        if (w > 0) {
          cachedWidth = w;
          return cachedWidth;
        }
      }
    }
  } catch (error) {
    // 没有 device 模块，或者字段名不一样
  }

  return null;
}

/**
 * 按屏幕宽度算字号倍率。
 *
 * 结果已夹在 [MIN_SCALE, MAX_SCALE]。
 */
function autoScale() {
  const width = screenWidth();
  if (!width || width <= 0) return MIN_SCALE;

  const raw = DESIGN_WIDTH / width;
  if (raw < MIN_SCALE) return MIN_SCALE;
  if (raw > MAX_SCALE) return MAX_SCALE;
  return raw;
}

/** 直接给一个 0.5 精度的倍率，便于打印 / 调试。 */
function autoScaleRounded() {
  return Math.round(autoScale() * 20) / 20;
}

module.exports = {
  DESIGN_WIDTH,
  MIN_SCALE,
  MAX_SCALE,
  screenWidth,
  autoScale,
  autoScaleRounded,
};
