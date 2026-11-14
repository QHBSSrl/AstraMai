/**
 * 屏幕与设备类型 —— 用来算字号倍率。
 *
 * ── 为什么需要它 ────────────────────────────────────────────────────
 *
 * Vela 的 `designWidth` 是 466，所有 CSS px 按 `物理宽 / designWidth` 缩放。
 *
 * 手环 9 Pro 只有 **336 宽** → 缩放比 0.72 → 22px 的字实际只有
 * 15.9 物理像素；手表 466 宽 → 缩放比 1.0 → 同样 22px 就是 22 像素。
 *
 * **手环上的字天生比手表小 28%** —— 这就是「看着费劲」的真正原因，
 * 不是字号写小了。
 *
 * ── 数据来源（官方文档确认过的字段）────────────────────────────────
 *
 * `device.getInfo({ success })` 返回：
 *
 *   screenWidth    屏幕宽
 *   screenHeight   屏幕高
 *   screenDensity  DPR（APILevel 3+，我们的 minAPILevel 是 2，可能没有）
 *   screenShape    rect / circle / pill-shaped
 *   deviceType     watch / band / smartspeaker   ← APILevel 2+，我们的目标
 *
 * ⚠️ **`screenWidth` 是物理像素还是逻辑像素，文档没说清。**
 *
 * 物理 336 和逻辑 336 算出来的倍率天差地别：
 *   逻辑 336 → 466/336 = 1.39  ✅
 *   物理 672 → 466/672 = 0.69  ❌（真值应该也是 1.39）
 *
 * 所以这里**不单独依赖 screenWidth**，而是取两个来源的最大值：
 *
 *   ① deviceType === 'band' → 1.35（保守值，够用）
 *   ② 466 / screenWidth，夹在 [1, 1.5]
 *
 * 取 max 之后：
 *   · screenWidth 是逻辑宽 → 1.39 胜出 ✅
 *   · screenWidth 是物理宽（偏大）→ 算出 <1，被夹到 1，由 ① 兜底 ✅
 *   · 手表 → 两者都 ≤1，最终 1.0 ✅
 *
 * **宁可放大不足，也不能放大过头把版面撑爆。**
 */

/** 设计稿宽度，和 manifest.json 的 designWidth 保持一致。 */
const DESIGN_WIDTH = 466;

/** 只放大不缩小 —— 比设计稿还宽的设备不需要把字变小。 */
const MIN_SCALE = 1;

/** 上限。再大就会挤爆列表行，宁可截断也不要版面崩掉。 */
const MAX_SCALE = 1.5;

/** 手环的保守倍率。拿不到屏幕宽度时靠这个。 */
const BAND_SCALE = 1.35;

/** 缓存 —— 设备信息不会变，别每次渲染都去问一次。 */
let cached = null;
let probing = false;

/**
 * 同步拿设备信息。
 *
 * ⚠️ `getInfo` 是**异步回调**式的，没有同步版本。
 * 所以这里做不了「同步返回」，只能在能拿到的时候缓存起来。
 *
 * 返回 null 表示还没探到 —— 调用方要用 [probe] 先探一次。
 */
function cachedInfo() {
  return cached;
}

/**
 * 探一次设备信息，结果缓存。
 *
 * 在 `app.ux` 的 `onCreate` 里调一次即可。之后所有地方都能同步读到。
 *
 * @param {Function} [onDone] 拿到之后回调，可以用来触发重绘
 */
function probe(onDone) {
  if (cached || probing) {
    if (cached && typeof onDone === 'function') onDone(cached);
    return;
  }

  probing = true;

  try {
    // eslint-disable-next-line global-require
    const device = require('@system.device');
    if (!device || typeof device.getInfo !== 'function') {
      probing = false;
      return;
    }

    device.getInfo({
      success: (info) => {
        cached = info || {};
        probing = false;

        /*
         * 打一行日志。
         *
         * 这不是调试残留 —— `screenWidth` 的单位问题只能靠真机日志确认，
         * 以后换设备、适配新机型时也要看这行。
         */
        console.log(
          '[AstraMai] device: type=' + (cached.deviceType || '?')
          + ' w=' + (cached.screenWidth || '?')
          + ' h=' + (cached.screenHeight || '?')
          + ' dpr=' + (cached.screenDensity || '?')
          + ' shape=' + (cached.screenShape || '?')
          + ' model=' + (cached.model || '?'),
        );

        if (typeof onDone === 'function') onDone(cached);
      },
      fail: () => {
        probing = false;
      },
    });
  } catch (error) {
    probing = false;
  }
}

/** 设备类型：watch / band / smartspeaker，取不到返回 ''。 */
function deviceType() {
  return (cached && cached.deviceType) || '';
}

/** 屏幕宽度，取不到返回 0。 */
function screenWidth() {
  const w = cached && cached.screenWidth;
  return typeof w === 'number' && w > 0 ? w : 0;
}

/** 屏幕形状。 */
function screenShape() {
  return (cached && cached.screenShape) || '';
}

/** 夹到 [MIN_SCALE, MAX_SCALE]。 */
function clampScale(value) {
  if (!(value > 0)) return MIN_SCALE;
  if (value < MIN_SCALE) return MIN_SCALE;
  if (value > MAX_SCALE) return MAX_SCALE;
  return value;
}

/**
 * 按设备算字号倍率。
 *
 * 见文件头的说明 —— 取「设备类型」和「屏幕宽度」两个来源的最大值。
 */
function autoScale() {
  const byType = deviceType() === 'band' ? BAND_SCALE : MIN_SCALE;

  const width = screenWidth();
  const byWidth = width > 0 ? clampScale(DESIGN_WIDTH / width) : MIN_SCALE;

  return clampScale(Math.max(byType, byWidth));
}

/** 便于打印的倍率（0.05 精度）。 */
function autoScaleRounded() {
  return Math.round(autoScale() * 20) / 20;
}

module.exports = {
  DESIGN_WIDTH,
  MIN_SCALE,
  MAX_SCALE,
  BAND_SCALE,
  cachedInfo,
  probe,
  deviceType,
  screenWidth,
  screenShape,
  autoScale,
  autoScaleRounded,
};
