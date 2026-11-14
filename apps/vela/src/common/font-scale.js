/**
 * 字号档位。
 *
 * ── 为什么需要这个 ──────────────────────────────────────────────────
 *
 * 有用户反馈手环上字太小、看着费劲。手环屏幕小、像素密度高，
 * 同一套 px 在手环上比在手表上明显更吃力。
 *
 * 但**不能只给手环放大** —— 手表用户会觉得字太大。所以做成可调的，
 * 默认给「大」（因为抱怨的方向是太小）。
 *
 * ── Vela 不支持 var()，所以在哪生效 ─────────────────────────────────
 *
 * 比较顺序是 `Scale.of('label')`，返回一个 px 字符串，页面直接绑到
 * `style="font-size: {{ fs.label }}"` 上 —— 内联样式是确定能用的，
 * 靠类名 + 后代选择器覆盖在 Vela 上不可靠。
 *
 * 用法：
 *
 *   const fontScale = require('../../common/font-scale.js');
 *
 *   onInit() {
 *     this.fontScale = fontScale.current();
 *     this.fs = fontScale.sizeSet(this.fontScale);
 *   }
 *
 *   <text style="font-size: {{ fs.label }}">…</text>
 */

const KEY = 'fontScale';

/** 两个档位。数值是相对标准的倍数。 */
const SCALES = {
  normal: 1,
  large: 1.18,
};

/** 各语义字号的标准值。改这里就能整体调。 */
const BASE = {
  title: 30,
  section: 17,
  label: 22,
  value: 20,
  hint: 15,
  tiny: 13,
};

/** 读当前档位。没设置过就是 large —— 抱怨的是「太小」。 */
function current(readSetting) {
  try {
    const saved = String(readSetting(KEY, '') || '');
    if (saved === 'normal' || saved === 'large') return saved;
  } catch (error) {
    // 读不到就用默认
  }
  return 'large';
}

/** 写档位。 */
function save(writeSetting, mode) {
  try {
    writeSetting(KEY, mode === 'normal' ? 'normal' : 'large');
  } catch (error) {
    console.warn('[AstraMai] 保存字号失败：', error);
  }
}

/** 档位 → 人类可读。 */
function label(mode) {
  return mode === 'normal' ? '标准' : '大';
}

/** 切到下一个档位。 */
function next(mode) {
  return mode === 'normal' ? 'large' : 'normal';
}

/** 档位 → 一组已经算好的 px 字符串。 */
function sizeSet(mode) {
  const k = SCALES[mode] || SCALES.large;
  const out = {};
  Object.keys(BASE).forEach((name) => {
    // 四舍五入到 0.5，避免出现 21.959999px 这种
    out[name] = `${Math.round(BASE[name] * k * 2) / 2}px`;
  });
  return out;
}

module.exports = {
  KEY,
  SCALES,
  current,
  save,
  label,
  next,
  sizeSet,
};
