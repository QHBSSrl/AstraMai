/**
 * 从模拟器抓屏幕截图。
 *
 * 背景：Vela 模拟器跑的是 NuttX，没有 Android 的 screencap，
 * IDE 的预览窗口又是隐藏的，所以一直没法确认界面到底渲染成什么样。
 * 解法：`/dev/fb0` 可读 → 设备上 cp 成文件 → adb pull → 自己拼 PNG。
 *
 * ── 两个设备族的差异（都是实测撞出来的，不是查文档）──────────────────
 *
 * | 设备 | 系统镜像 | 分辨率 | 帧缓冲格式 |
 * |---|---|---|---|
 * | REDMI Watch 5（矩形） | `vela-pre-4.0` | 432×514 | **RGB565**，2 字节/像素 |
 * | Xiaomi Watch 圆屏 | `vela-miwear-watch-5.0` | 466×466 | **RGBA8888**，4 字节/像素 |
 *
 * RGB565 的验算：页面底色 #070b16 → R5=0,G6=2,B5=2 → 0x0042 → 小端字节
 * `42 00`，与实测 `[66,0,66,0]` 吻合。
 * RGBA8888 的依据：帧缓冲开头是 `00 00 00 ff`，第 4 字节恒为 ff——
 * 那是 alpha 通道，RGB565 下不可能有这种规律。
 *
 * ⚠️ **格式不能用画面内容去猜。** 试过「看每第 4 字节是不是 0xff」，
 * 但全黑帧下两种格式都成立（RGBA8888 全零帧也是 00 00 00 00），
 * 实测同一台设备一次判成 RGBA8888、一次判成 RGB565。
 * 所以改成**按机型查表**，确定性判断。
 *
 * 用法: node scripts/vela-screencap.mjs [输出路径]
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

/**
 * 已知机型的屏幕规格。
 *
 * 分辨率来自官方多屏适配文档的设备表；**格式来自实测**。
 * 加新机型时两列都要确认——只填分辨率会渲染成花屏。
 */
const KNOWN_SCREENS = [
  { width: 480, height: 480, bytesPerPixel: 4, name: 'Xiaomi Watch S1 Pro / S5（圆）' },
  { width: 466, height: 466, bytesPerPixel: 4, name: 'Xiaomi Watch H1 / S3 / S4（圆）' },
  { width: 432, height: 514, bytesPerPixel: 2, name: 'REDMI Watch 5（矩形）' },
  { width: 336, height: 480, bytesPerPixel: 2, name: '小米手环 8 Pro / 9 Pro（矩形）' },
  { width: 212, height: 520, bytesPerPixel: 2, name: '小米手环 10（胶囊）' },
  { width: 192, height: 490, bytesPerPixel: 2, name: '小米手环 9（胶囊）' },
];

/** 从帧缓冲总字节数反推「机型 + 帧数」。 */
function detectScreen(totalBytes) {
  for (const screen of KNOWN_SCREENS) {
    const frameBytes = screen.width * screen.height * screen.bytesPerPixel;
    if (frameBytes > 0 && totalBytes % frameBytes === 0) {
      return { ...screen, frames: totalBytes / frameBytes };
    }
  }
  return null;
}

const localBin = resolve(import.meta.dirname, '../fb.bin');
rmSync(localBin, { force: true });
execFileSync(ADB, ['-s', DEVICE, 'shell', 'cp /dev/fb0 /data/fb.bin'], { stdio: 'pipe' });
execFileSync(ADB, ['-s', DEVICE, 'pull', '/data/fb.bin', localBin], { stdio: 'pipe' });

const raw = readFileSync(localBin);
const detected = detectScreen(raw.length);
if (!detected) {
  console.error(`认不出这个帧缓冲大小：${raw.length} 字节。`);
  console.error('如果是新机型，请把它的分辨率和格式加进 KNOWN_SCREENS。');
  process.exit(1);
}

const WIDTH = detected.width;
const HEIGHT = detected.height;
const BPP = detected.bytesPerPixel;
const FRAME_BYTES = WIDTH * HEIGHT * BPP;

if (raw.length < FRAME_BYTES) {
  console.error(`帧缓冲太小：${raw.length} < ${FRAME_BYTES}`);
  process.exit(1);
}

// 解成 RGB888
const rgb = Buffer.alloc(WIDTH * HEIGHT * 3);
for (let i = 0; i < WIDTH * HEIGHT; i += 1) {
  if (BPP === 4) {
    // RGBA8888：顺序就是 R,G,B,A；第 4 字节是 alpha，丢弃
    const off = i * 4;
    rgb[i * 3] = raw[off];
    rgb[i * 3 + 1] = raw[off + 1];
    rgb[i * 3 + 2] = raw[off + 2];
  } else {
    // RGB565 小端
    const v = raw[i * 2] | (raw[i * 2 + 1] << 8);
    const r = ((v >> 11) & 0x1f) << 3;
    const g = ((v >> 5) & 0x3f) << 2;
    const b = (v & 0x1f) << 3;
    // 低位补足，避免整体偏暗
    rgb[i * 3] = r | (r >> 5);
    rgb[i * 3 + 1] = g | (g >> 6);
    rgb[i * 3 + 2] = b | (b >> 5);
  }
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
console.log(
  `${WIDTH}×${HEIGHT} ${BPP === 4 ? 'RGBA8888' : 'RGB565'}（${detected.frames} 帧）· ${detected.name}`,
);
console.log(`  → ${OUT}`);
console.log(`  近黑像素占比: ${((dark / (WIDTH * HEIGHT)) * 100).toFixed(1)}%`);
console.log(`  采样颜色数  : ${distinct.size}`);
