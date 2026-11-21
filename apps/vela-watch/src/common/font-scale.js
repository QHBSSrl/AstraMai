/**
 * 字号档位。
 *
 * ── 问题不是「字写小了」，是 designWidth 不匹配 ────────────────────
 *
 * Vela 的 `designWidth` 是 466，所有 CSS px 按 `物理宽 / 466` 缩放。
 *
 * 手环 9 Pro 只有 **336 宽** → 缩放比 0.72 → 22px 的字实际只有
 * 15.9 物理像素；手表 466 宽 → 缩放比 1.0 → 同样 22px 就是 22 像素。
 *
 * **手环上的字天生比手表小 28%。** 所以光把数值调大没用 ——
 * 得按设备宽度算倍率。
 *
 * ── 三档 ────────────────────────────────────────────────────────────
 *
 *   auto   默认。按屏幕宽度算（手环 ≈ 1.39，手表 ≈ 1.0）
 *   normal 固定 1.0，字最小
 *   large  固定 1.18，比标准稍大
 *
 * ── 怎么生效 ────────────────────────────────────────────────────────
 *
 * Vela 不支持 `var()`，类名 + 后代选择器覆盖也不可靠。
 * 所以这里导出的是**算好的一组 px 字符串**，页面直接绑到
 * `style="font-size: {{ fs.label }}"` 上 —— 内联样式是确定能用的。
 */

const screenSize = require('./screen-size.js');

const KEY = 'fontScale';

/** 各语义字号的标准值（designWidth 466 下的 px）。 */
const BASE = {
  title: 30,
  section: 17,
  label: 22,
  value: 20,
  hint: 15,
  tiny: 13,
};

/** 固定档位。auto 不在这里，它要现算。 */
const FIXED = {
  normal: 1,
  large: 1.18,
};

/** 读当前档位。默认 auto。 */
function current(readSetting) {
  try {
    const saved = String(readSetting(KEY, '') || '');
    if (saved === 'auto' || saved === 'normal' || saved === 'large') return saved;
  } catch (error) {
    // 读不到就用默认
  }
  return 'auto';
}

/** 写档位。 */
function save(writeSetting, mode) {
  const next = mode === 'normal' || mode === 'large' ? mode : 'auto';
  try {
    writeSetting(KEY, next);
  } catch (error) {
    console.warn('[AstraMai] 保存字号失败：', error);
  }
}

/** 档位 → 人类可读。 */
function label(mode) {
  if (mode === 'normal') return '标准';
  if (mode === 'large') return '大';
  return '自动';
}

/** 切到下一个档位：自动 → 标准 → 大 → 自动。 */
function next(mode) {
  if (mode === 'auto') return 'normal';
  if (mode === 'normal') return 'large';
  return 'auto';
}

/** 档位 → 实际倍率。 */
function scaleOf(mode) {
  if (mode === 'normal' || mode === 'large') return FIXED[mode];
  return screenSize.autoScale();
}

/** 档位 → 一组已经算好的 px 字符串。 */
function sizeSet(mode) {
  const k = scaleOf(mode);
  const out = {};
  Object.keys(BASE).forEach((name) => {
    // 四舍五入到 0.5，避免出现 21.959999px 这种
    out[name] = `${Math.round(BASE[name] * k * 2) / 2}px`;
  });
  return out;
}

module.exports = {
  KEY,
  BASE,
  FIXED,
  current,
  save,
  label,
  next,
  scaleOf,
  sizeSet,
};
