/**
 * QR 点阵的渲染辅助。
 *
 * 全部输出都是「字符串 + 数字」，不含任何 DOM/Canvas 依赖，
 * 因此同一份代码在浏览器、Node 与 Vela 端都能用：
 *   - 浏览器/Vela：把 {@link qrToPathData} 喂给自己的矢量或画布绘制
 *   - 终端/日志：用 {@link qrToBlockArt} 直接肉眼检查
 */

import type { QrCode } from './encoder.js';

export interface QrSvgOptions {
  /** 静区宽度（模块数），规范要求至少 4。 */
  quietZone?: number;
  /** 每个模块的像素边长。 */
  moduleSize?: number;
  /** 深色模块颜色。 */
  dark?: string;
  /** 浅色背景色；传 `'transparent'` 可得到透明背景。 */
  light?: string;
  /** 是否输出 `shape-rendering="crispEdges"`，避免缩放时出现灰边。 */
  crispEdges?: boolean;
}

/**
 * 生成紧凑的 SVG path——按行合并连续深色模块，路径长度只与「色块数」相关，
 * 而不是与模块总数相关（对高版本二维码能小一个数量级）。
 *
 * 坐标原点在静区左上角。
 */
export function qrToPathData(qr: QrCode, quietZone = 4): string {
  const parts: string[] = [];
  for (let y = 0; y < qr.size; y += 1) {
    let x = 0;
    while (x < qr.size) {
      if (!qr.isDark(y, x)) {
        x += 1;
        continue;
      }
      let run = 1;
      while (x + run < qr.size && qr.isDark(y, x + run)) run += 1;
      parts.push(`M${x + quietZone} ${y + quietZone}h${run}v1h-${run}z`);
      x += run;
    }
  }
  return parts.join('');
}

/** 生成完整 SVG 文档。 */
export function qrToSvg(qr: QrCode, options: QrSvgOptions = {}): string {
  const quietZone = options.quietZone ?? 4;
  const moduleSize = options.moduleSize ?? 8;
  const dark = options.dark ?? '#000000';
  const light = options.light ?? '#ffffff';
  const side = (qr.size + quietZone * 2) * moduleSize;

  const background =
    light === 'transparent'
      ? ''
      : `<rect width="${side}" height="${side}" fill="${light}"/>`;

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${side}" height="${side}" viewBox="0 0 ${side} ${side}"`,
    ` role="img" aria-label="QR Code">`,
    background,
    `<path d="${qrToPathData(qr, quietZone)}" fill="${dark}"`,
    options.crispEdges === false ? '' : ' shape-rendering="crispEdges"',
    '/>',
    '</svg>',
  ].join('');
}

/**
 * 用等宽字符画出点阵，方便在终端或日志里肉眼确认。
 * 每个模块占两个字符宽，以便接近正方形。
 */
export function qrToBlockArt(qr: QrCode, options: { quietZone?: number; dark?: string; light?: string } = {}): string {
  const quietZone = options.quietZone ?? 2;
  const dark = options.dark ?? '██';
  const light = options.light ?? '  ';
  const rows: string[] = [];
  const blank = light.repeat(qr.size + quietZone * 2);

  for (let i = 0; i < quietZone; i += 1) rows.push(blank);
  for (let y = 0; y < qr.size; y += 1) {
    let line = light.repeat(quietZone);
    for (let x = 0; x < qr.size; x += 1) line += qr.isDark(y, x) ? dark : light;
    line += light.repeat(quietZone);
    rows.push(line);
  }
  for (let i = 0; i < quietZone; i += 1) rows.push(blank);

  return rows.join('\n');
}

/**
 * 把点阵写进一个 RGBA 像素缓冲区，供 Canvas / 手表的位图绘制使用。
 *
 * @param scale 每个模块占多少像素
 */
export function qrToRgba(
  qr: QrCode,
  scale = 4,
  options: { quietZone?: number; dark?: [number, number, number, number]; light?: [number, number, number, number] } = {},
): { width: number; height: number; data: Uint8ClampedArray } {
  const quietZone = options.quietZone ?? 4;
  const dark = options.dark ?? [0, 0, 0, 255];
  const light = options.light ?? [255, 255, 255, 255];
  const side = (qr.size + quietZone * 2) * scale;

  const data = new Uint8ClampedArray(side * side * 4);
  for (let py = 0; py < side; py += 1) {
    for (let px = 0; px < side; px += 1) {
      const mx = Math.floor(px / scale) - quietZone;
      const my = Math.floor(py / scale) - quietZone;
      const isDark = mx >= 0 && my >= 0 && mx < qr.size && my < qr.size && qr.isDark(my, mx);
      const color = isDark ? dark : light;
      const offset = (py * side + px) * 4;
      data[offset] = color[0];
      data[offset + 1] = color[1];
      data[offset + 2] = color[2];
      data[offset + 3] = color[3];
    }
  }

  return { width: side, height: side, data };
}
