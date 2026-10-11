/**
 * 生成 Vela 应用图标（192×192 PNG）。
 *
 * 为什么需要这个：`manifest.json` 里的 `icon` 是必填项，
 * 指向一个不存在的文件会在构建阶段直接失败——IDE 只会报「项目无法启动」，
 * 不会告诉你缺的是图标。
 *
 * 画的是 **AstraMai 的 A 字标**：深色底 + 品牌品红的 "A"。
 * 之前那版是「深色底 + 品红圆角方块」——那是纯占位，什么都看不出来。
 *
 * 手写 PNG 而不是引入图形库：这个仓库在手表端是零依赖的，
 * 生成脚本也不该为了一个图标拖进 sharp/canvas 这种重家伙。
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const SIZE = 192;
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../apps/vela/src/common/icon.png');

/** 品牌色。和界面里的粉保持一致（#ff5f9e）。 */
const BACKGROUND = [0x0a, 0x0e, 0x1a];
const BRAND = [0xff, 0x5f, 0x9e];
/** 让 A 有一点点纵向渐变，纯平色会显得很"占位"。 */
const BRAND_DEEP = [0xd6, 0x3d, 0x86];

/**
 * 点到线段的最短距离。
 * 用距离场画笔画，比拼像素判定更好控制粗细和圆角。
 */
function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  let t = lengthSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/** A 字标的笔画。坐标基于 192×192，留出安全边距（表盘会裁圆角）。 */
const STROKE = 15;
const APEX = [96, 42];
const FEET_LEFT = [52, 150];
const FEET_RIGHT = [140, 150];
/** 横杠：取两腿在那个高度上的内侧点。 */
const BAR_Y = 116;
const BAR_LEFT = [74, BAR_Y];
const BAR_RIGHT = [118, BAR_Y];

/** 像素是否属于 A。 */
function insideA(x, y) {
  const legs = Math.min(
    distanceToSegment(x, y, APEX[0], APEX[1], FEET_LEFT[0], FEET_LEFT[1]),
    distanceToSegment(x, y, APEX[0], APEX[1], FEET_RIGHT[0], FEET_RIGHT[1]),
  );
  const bar = distanceToSegment(x, y, BAR_LEFT[0], BAR_LEFT[1], BAR_RIGHT[0], BAR_RIGHT[1]);
  return Math.min(legs, bar) <= STROKE;
}

/** 按 y 在品牌色和深色之间做插值，避免大面积平色。 */
function brandAt(y) {
  const t = Math.max(0, Math.min(1, (y - APEX[1]) / (FEET_RIGHT[1] - APEX[1])));
  return [
    Math.round(BRAND[0] + (BRAND_DEEP[0] - BRAND[0]) * t),
    Math.round(BRAND[1] + (BRAND_DEEP[1] - BRAND[1]) * t),
    Math.round(BRAND[2] + (BRAND_DEEP[2] - BRAND[2]) * t),
  ];
}

/** 边缘 1px 抗锯齿：按到笔画的距离在底色与品牌色之间过渡。 */
function sample(x, y) {
  const legs = Math.min(
    distanceToSegment(x, y, APEX[0], APEX[1], FEET_LEFT[0], FEET_LEFT[1]),
    distanceToSegment(x, y, APEX[0], APEX[1], FEET_RIGHT[0], FEET_RIGHT[1]),
  );
  const bar = distanceToSegment(x, y, BAR_LEFT[0], BAR_LEFT[1], BAR_RIGHT[0], BAR_RIGHT[1]);
  const d = Math.min(legs, bar);
  const coverage = Math.max(0, Math.min(1, STROKE + 0.5 - d));
  const fg = brandAt(y);
  return [
    Math.round(BACKGROUND[0] + (fg[0] - BACKGROUND[0]) * coverage),
    Math.round(BACKGROUND[1] + (fg[1] - BACKGROUND[1]) * coverage),
    Math.round(BACKGROUND[2] + (fg[2] - BACKGROUND[2]) * coverage),
  ];
}

// ── 像素数据（每行前置一个过滤器字节）──────────────────────────────────
const raw = Buffer.alloc(SIZE * (SIZE * 3 + 1));
for (let y = 0; y < SIZE; y += 1) {
  const rowStart = y * (SIZE * 3 + 1);
  raw[rowStart] = 0;
  for (let x = 0; x < SIZE; x += 1) {
    const color = sample(x + 0.5, y + 0.5);
    const offset = rowStart + 1 + x * 3;
    raw[offset] = color[0];
    raw[offset + 1] = color[1];
    raw[offset + 2] = color[2];
  }
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
  for (let i = 0; i < buffer.length; i += 1) {
    c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  }
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

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // 位深
ihdr[9] = 2; // 颜色类型：真彩色
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, png);
console.log(`已生成 ${OUT}`);
console.log(`  ${SIZE}×${SIZE}，${png.length} 字节`);
void insideA;
