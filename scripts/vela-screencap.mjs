/**
 * 从模拟器抓屏幕截图。
 *
 * 背景：Vela 模拟器跑的是 NuttX，没有 Android 的 screencap，
 * IDE 的预览窗口又是隐藏的，所以一直没法确认界面到底渲染成什么样。
 * 解法：`/dev/fb0` 可读 → 设备上 cp 成文件 → adb pull → 自己拼 PNG。
 *
 * 实测（用像素值反推确认，不是猜的）：
 *   - 分辨率 432 × 514，与 REDMI Watch 5 一致
 *   - 格式 **RGB565 小端**（2 字节/像素）
 *     验算：页面底色 #070b16 → R5=0,G6=2,B5=2 → 0x0042 → 小端字节 `42 00`，与实测 `[66,0,66,0]` 吻合
 *          卡片色 #141d30 → 0x10E6 → 小端字节 `E6 10`，与实测 `[230,16,230,16]` 吻合
 *   - framebuffer 总大小是单帧的 2 倍（888192 = 432×514×2×2），只取第一帧
 *
 * 用法: node .probe/verify/screencap.mjs [输出路径]
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { deflateSync } from 'node:zlib';

const ADB =
  process.env.VELA_ADB ??
  `${process.env.USERPROFILE}\\.vela\\sdk\\tools\\adb\\win\\adb.exe`;
const DEVICE = process.env.VELA_DEVICE ?? 'emulator-5554';

const args = process.argv.slice(2);
const OUT = resolve(
  args.find((a) => !a.startsWith('--')) ?? resolve(import.meta.dirname, '../screen.png'),
);

const WIDTH = 432;
const HEIGHT = 514;
const FRAME_BYTES = WIDTH * HEIGHT * 2;

const localBin = resolve(import.meta.dirname, '../fb.bin');
rmSync(localBin, { force: true });
execFileSync(ADB, ['-s', DEVICE, 'shell', 'cp /dev/fb0 /data/fb.bin'], { stdio: 'pipe' });
execFileSync(ADB, ['-s', DEVICE, 'pull', '/data/fb.bin', localBin], { stdio: 'pipe' });

const raw = readFileSync(localBin);
if (raw.length < FRAME_BYTES) {
  console.error(`framebuffer 太小：${raw.length} < ${FRAME_BYTES}`);
  process.exit(1);
}

// RGB565 小端 → RGB888
const rgb = Buffer.alloc(WIDTH * HEIGHT * 3);
for (let i = 0; i < WIDTH * HEIGHT; i += 1) {
  const lo = raw[i * 2];
  const hi = raw[i * 2 + 1];
  const v = lo | (hi << 8);
  const r = ((v >> 11) & 0x1f) << 3;
  const g = ((v >> 5) & 0x3f) << 2;
  const b = (v & 0x1f) << 3;
  // 低位补足，避免整体偏暗
  rgb[i * 3] = r | (r >> 5);
  rgb[i * 3 + 1] = g | (g >> 6);
  rgb[i * 3 + 2] = b | (b >> 5);
}

// ── 手写 PNG ──────────────────────────────────────────────────────────
const rawRows = Buffer.alloc(HEIGHT * (WIDTH * 3 + 1));
for (let y = 0; y < HEIGHT; y += 1) {
  rawRows[y * (WIDTH * 3 + 1)] = 0;
  rgb.copy(rawRows, y * (WIDTH * 3 + 1) + 1, y * WIDTH * 3, (y + 1) * WIDTH * 3);
}
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(WIDTH, 0);
ihdr.writeUInt32BE(HEIGHT, 4);
ihdr[8] = 8;
ihdr[9] = 2;
writeFileSync(
  OUT,
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(rawRows, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]),
);

// 采样判断画面是否全黑 / 是否有内容
let dark = 0;
const distinct = new Set();
for (let i = 0; i < WIDTH * HEIGHT; i += 1) {
  const r = rgb[i * 3];
  const g = rgb[i * 3 + 1];
  const b = rgb[i * 3 + 2];
  if (r < 20 && g < 20 && b < 20) dark += 1;
  if (i % 971 === 0) distinct.add(`${r},${g},${b}`);
}
console.log(`${WIDTH}×${HEIGHT} RGB565 → ${OUT}`);
console.log(`  近黑像素占比: ${((dark / (WIDTH * HEIGHT)) * 100).toFixed(1)}%`);
console.log(`  采样颜色数  : ${distinct.size}`);
