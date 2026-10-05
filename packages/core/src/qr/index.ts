/**
 * QR Code 生成（零依赖）。
 *
 * @example
 * ```ts
 * import { encodeQr, qrToSvg } from '@astramai/core';
 *
 * const qr = encodeQr('https://example.com/player?token=...');
 * const svg = qrToSvg(qr, { moduleSize: 6 });
 * ```
 */

export * from './tables.js';
export * from './galois.js';
export * from './encoder.js';
export * from './render.js';
