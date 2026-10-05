/**
 * 生成 Vela 应用的占位图标（192×192 PNG）。
 *
 * 为什么需要这个：`manifest.json` 里的 `icon` 是必填项，
 * 指向一个不存在的文件会在构建阶段直接失败——IDE 只会报「项目无法启动」，
 * 不会告诉你缺的是图标。
 *
 * 这里手写一个合法 PNG（深色底 + 品红圆角方块），零依赖，正式发布前换成设计稿。
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const SIZE = 192;
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../apps/vela/src/common/icon.png');

const BACKGROUND = [0x0a, 0x0e, 0x1a];
const FOREGROUND = [0xff, 0x5f, 0x9e];
const MARGIN = 36;
const RADIUS = 30;

/** 圆角矩形填充判定。 */
function insideRoundedRect(x, y) {
  if (x < MARGIN || x >= SIZE - MARGIN || y < MARGIN || y >= SIZE - MARGIN) return false;
  const innerLeft = MARGIN + RADIUS;
  const innerRight = SIZE - MARGIN - RADIUS - 1;
  const innerTop = MARGIN + RADIUS;
  const innerBottom = SIZE - MARGIN - RADIUS - 1;
  const dx = Math.max(innerLeft - x, 0, x - innerRight);
  const dy = Math.max(innerTop - y, 0, y - innerBottom);
  return dx * dx + dy * dy <= RADIUS * RADIUS;
}

// ── 像素数据（每行前置一个过滤器字节）──────────────────────────────────
const raw = Buffer.alloc(SIZE * (SIZE * 3 + 1));
for (let y = 0; y < SIZE; y += 1) {
  const rowStart = y * (SIZE * 3 + 1);
  raw[rowStart] = 0;
  for (let x = 0; x < SIZE; x += 1) {
    const color = insideRoundedRect(x, y) ? FOREGROUND : BACKGROUND;
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
