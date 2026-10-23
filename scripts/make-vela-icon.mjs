/**
 * 生成 Vela 应用图标（多尺寸 PNG）。
 *
 * 画的是 **AstraMai 的 A 字标**：深色底 + 品牌品红的 "A"。
 *
 * ── 为什么输出多个尺寸 ──────────────────────────────────────────────
 *
 * `manifest.json` 里的 `icon` 是必填项，指向不存在的文件会构建失败，
 * 所以 192×192 是必须的（也是手表上的实际显示尺寸）。
 * 但**应用商店上传时通常还要单独交一张大图**，而官方《验收标准》那页
 * 只规定了启动性能（FMP ≤ 2000ms），**没写图标尺寸**。
 *
 * 与其猜一个尺寸，不如把常见的几个都生成出来，交审核时挑对应的那张。
 * 图形是程序化画的（距离场 + 抗锯齿），放大不会糊，所以多大都行。
 *
 * 用法：
 *   node scripts/make-vela-icon.mjs          生成全部尺寸
 *   node scripts/make-vela-icon.mjs 1024     只生成某一个尺寸
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
/** manifest 引用的那张，尺寸固定 192。 */
const ICON_DIR = resolve(HERE, '../apps/vela/src/common');
/** 给商店用的额外尺寸放这里，不打进包。 */
const STORE_DIR = resolve(HERE, '../assets/icon');

/** 品牌色，和界面里的粉一致（#ff5f9e）。 */
const BACKGROUND = [0x0a, 0x0e, 0x1a];
const BRAND = [0xff, 0x5f, 0x9e];
/** 让 A 有一点纵向渐变，纯平色会显得很"占位"。 */
const BRAND_DEEP = [0xd6, 0x3d, 0x86];

/**
 * A 字标的几何，用**归一化坐标**（0..1）表示。
 * 这样换尺寸只要乘一下，不用改图形本身——
 * 原来写死 192 的像素坐标，加一个尺寸就得把图形再抄一遍。
 *
 * 坐标留了安全边距：表盘会裁圆角，商店也可能加圆角蒙版。
 */
const APEX = [0.5, 0.219];
const FOOT_LEFT = [0.271, 0.781];
const FOOT_RIGHT = [0.729, 0.781];
const BAR_Y = 0.604;
const BAR_LEFT = [0.385, BAR_Y];
const BAR_RIGHT = [0.615, BAR_Y];
/** 笔画半宽，同样是归一化值（192 下相当于 15px）。 */
const STROKE = 0.078;

/**
 * A 字标相对圆形的缩放。
 *
 * ⚠️ **图标是圆形的，不是方块。**
 *
 * 上一版画的是整块方块底，实机上显示出来是方的——手表/手环的启动器
 * **不会帮你裁圆**，所以图形本身就得是圆的。
 *
 * 圆形直径 = 画布边长，A 的笔画外缘最远到半径的 88%（0.44/0.5），
 * 再乘这个缩放把安全边距拉开一点，免得贴着圆边显得挤。
 */
const INNER_SCALE = 0.88;

/** 点到线段的最短距离。用距离场画笔画，比拼像素判定更好控制粗细和圆角。 */
function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  let t = lengthSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** 按 y 在品牌色和深色之间插值，避免大面积平色。 */
function brandAt(y) {
  const k = Math.max(0, Math.min(1, (y - APEX[1]) / (FOOT_RIGHT[1] - APEX[1])));
  return [
    Math.round(BRAND[0] + (BRAND_DEEP[0] - BRAND[0]) * k),
    Math.round(BRAND[1] + (BRAND_DEEP[1] - BRAND[1]) * k),
    Math.round(BRAND[2] + (BRAND_DEEP[2] - BRAND[2]) * k),
  ];
}

/** 生成某个尺寸的 RGBA 像素数据（每行前置一个过滤器字节）。 */
function render(size) {
  // 抗锯齿过渡宽度按尺寸缩放，小图上也不会糊
  const soft = Math.max(0.5, size / 384);

  /*
   * RGBA：每像素 4 字节。
   * 圆外那一圈的 alpha = 0，所以启动器上看到的是**圆形**，不是方块。
   */
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(size * stride);
  /** 圆的抗锯齿过渡宽度。 */
  const edge = 1.5 / size;

  for (let y = 0; y < size; y += 1) {
    const rowStart = y * stride;
    raw[rowStart] = 0; // PNG 行过滤器：None
    for (let x = 0; x < size; x += 1) {
      const px = (x + 0.5) / size;
      const py = (y + 0.5) / size;

      // 圆：以画布中心为心、半径为 0.5（正好内切）
      const distFromCenter = Math.hypot(px - 0.5, py - 0.5);
      const circleCoverage = Math.max(
        0,
        Math.min(1, (0.5 - distFromCenter) / edge + 0.5),
      );

      // A 的查询点先缩放到内圈，留出安全边距
      const sx = 0.5 + (px - 0.5) / INNER_SCALE;
      const sy = 0.5 + (py - 0.5) / INNER_SCALE;

      const legs = Math.min(
        distanceToSegment(sx, sy, APEX[0], APEX[1], FOOT_LEFT[0], FOOT_LEFT[1]),
        distanceToSegment(sx, sy, APEX[0], APEX[1], FOOT_RIGHT[0], FOOT_RIGHT[1]),
      );
      const bar = distanceToSegment(sx, sy, BAR_LEFT[0], BAR_LEFT[1], BAR_RIGHT[0], BAR_RIGHT[1]);
      const d = Math.min(legs, bar);

      // 覆盖度：笔画内为 1，边缘按距离平滑过渡
      const coverage = Math.max(0, Math.min(1, (STROKE - d) / (soft / size) + 0.5));
      const fg = brandAt(sy);

      const offset = rowStart + 1 + x * 4;
      raw[offset] = Math.round(BACKGROUND[0] + (fg[0] - BACKGROUND[0]) * coverage);
      raw[offset + 1] = Math.round(BACKGROUND[1] + (fg[1] - BACKGROUND[1]) * coverage);
      raw[offset + 2] = Math.round(BACKGROUND[2] + (fg[2] - BACKGROUND[2]) * coverage);
      // 圆外完全透明——这是图标看起来是圆的而不是方的关键
      raw[offset + 3] = Math.round(circleCoverage * 255);
    }
  }
  return raw;
}

// ── PNG 封装 ────────────────────────────────────────────────────────────
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

function toPng(size, raw) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // 位深
  // 颜色类型 6 = RGBA。**必须带 alpha**，否则圆外那一圈没法透明，
  // 图标在启动器上还是会显示成方块。
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── 跑 ──────────────────────────────────────────────────────────────────
const requested = process.argv
  .slice(2)
  .map(Number)
  .filter((n) => Number.isInteger(n) && n >= 16);
const sizes = requested.length > 0 ? requested : [192, 216, 512, 1024];

mkdirSync(ICON_DIR, { recursive: true });
mkdirSync(STORE_DIR, { recursive: true });

for (const size of sizes) {
  const png = toPng(size, render(size));
  // manifest 引用的那张固定在 ICON_DIR 且必须叫 icon.png
  const out = size === 192 ? resolve(ICON_DIR, 'icon.png') : resolve(STORE_DIR, `icon-${size}.png`);
  writeFileSync(out, png);
  console.log(
    `  ${String(size).padStart(4)}×${String(size).padEnd(4)}  ${String(png.length).padStart(7)} 字节  ${out}`,
  );
}
