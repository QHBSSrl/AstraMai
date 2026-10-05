/**
 * QR Code 编码器（字节模式）。
 *
 * 为什么自己写而不是引第三方包：
 *   1. Vela QuickApp 的依赖链路不明朗，能用零依赖纯 TS 就不要赌 npm 安装；
 *   2. 手表端只需要「一段字符串 → 一张点阵」，用不到库里的 DOM/Canvas 绑定；
 *   3. 这个模块不引用任何环境 API（连 `TextEncoder` 都自己实现了），
 *      在 Node / 浏览器 / QuickApp 里行为完全一致。
 *
 * 实现依据 ISO/IEC 18004。只做字节模式——玩家二维码是 URL，
 * 数字/字母数字模式的容量优化在这里没有价值。
 */

import { utf8Encode } from '../util/utf8.js';
import { rsGeneratorPolynomial, rsRemainder } from './galois.js';
import {
  ECC_CODEWORDS_PER_BLOCK,
  EC_LEVEL_FORMAT_BITS,
  MAX_VERSION,
  MIN_VERSION,
  MODE_BYTE,
  NUM_EC_BLOCKS,
  byteModeCharCountBits,
  type QrErrorCorrectionLevel,
} from './tables.js';

export interface QrEncodeOptions {
  /** 纠错等级，默认 `M`（容错约 15%）。 */
  ecLevel?: QrErrorCorrectionLevel;
  /** 允许的最小版本，默认 1。 */
  minVersion?: number;
  /** 允许的最大版本，默认 40。 */
  maxVersion?: number;
  /** 强制指定掩码（0–7）。默认按标准罚分规则自动选最优。 */
  mask?: number;
}

/** 编码结果。 */
export interface QrCode {
  /** 原始文本（字节模式输入为 UTF-8 时才有意义）。 */
  readonly text: string | null;
  readonly version: number;
  readonly ecLevel: QrErrorCorrectionLevel;
  /** 最终使用的掩码编号。 */
  readonly mask: number;
  /** 边长（模块数，不含静区）。 */
  readonly size: number;
  /** `size * size` 的点阵，下标为 `row * size + col`，1 表示深色。 */
  readonly modules: Uint8Array;
  /** 取某一点是否为深色。 */
  isDark(row: number, col: number): boolean;
  /** 深色模块总数，用于自检与渲染优化。 */
  readonly darkCount: number;
}

/** 版本 → 边长（模块数）。 */
export function qrSizeOfVersion(version: number): number {
  return version * 4 + 17;
}

/** 版本 → 排除功能图形后可用的原始模块数（含剩余位）。 */
export function rawDataModules(version: number): number {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const numAlign = Math.floor(version / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}

/** 版本 + 纠错等级 → 数据码字数。 */
export function numDataCodewords(version: number, ecLevel: QrErrorCorrectionLevel): number {
  const ecc = ECC_CODEWORDS_PER_BLOCK[ecLevel][version];
  const blocks = NUM_EC_BLOCKS[ecLevel][version];
  if (ecc === undefined || blocks === undefined) {
    throw new RangeError(`版本 ${version} 超出 1..40 范围`);
  }
  return Math.floor(rawDataModules(version) / 8) - ecc * blocks;
}

/**
 * 对齐图形中心坐标。
 * 版本 1 没有对齐图形；版本 32 的步长是规范里的特例。
 */
export function alignmentPatternPositions(version: number): number[] {
  if (version === 1) return [];
  const numAlign = Math.floor(version / 7) + 2;
  const step =
    version === 32 ? 26 : Math.floor((version * 4 + numAlign * 2 + 1) / (numAlign * 2 - 2)) * 2;

  const result = new Array<number>(numAlign);
  result[0] = 6;
  for (let i = result.length - 1, pos = version * 4 + 10; i >= 1; i -= 1, pos -= step) {
    result[i] = pos;
  }
  return result;
}

// ── 输入编码 ────────────────────────────────────────────────────────────

// UTF-8 编码放在 util 里（那里还有解码与十六进制工具），此处直接复用。

// ── 主入口 ──────────────────────────────────────────────────────────────

/** 编码一段文本（按 UTF-8 字节处理）。 */
export function encodeQr(text: string, options: QrEncodeOptions = {}): QrCode {
  return encodeQrBytes(utf8Encode(text), options, text);
}

/** 编码任意字节序列。 */
export function encodeQrBytes(
  bytes: ArrayLike<number>,
  options: QrEncodeOptions = {},
  text: string | null = null,
): QrCode {
  const ecLevel = options.ecLevel ?? 'M';
  const minVersion = clampVersion(options.minVersion ?? MIN_VERSION);
  const maxVersion = clampVersion(options.maxVersion ?? MAX_VERSION);
  if (minVersion > maxVersion) {
    throw new RangeError(`minVersion(${minVersion}) 不能大于 maxVersion(${maxVersion})`);
  }

  const version = pickVersion(bytes.length, ecLevel, minVersion, maxVersion);
  const dataCodewords = buildDataCodewords(bytes, version, ecLevel);
  const allCodewords = addEccAndInterleave(dataCodewords, version, ecLevel);

  const size = qrSizeOfVersion(version);
  const modules = new Uint8Array(size * size);
  const isFunction = new Uint8Array(size * size);
  const matrix = { size, modules, isFunction };

  drawFunctionPatterns(matrix, version, ecLevel);
  drawCodewords(matrix, allCodewords);

  const mask = options.mask ?? chooseMask(matrix, ecLevel);
  if (mask < 0 || mask > 7) throw new RangeError(`掩码必须是 0..7，收到 ${mask}`);

  applyMask(matrix, mask);
  drawFormatBits(matrix, ecLevel, mask);

  let darkCount = 0;
  for (let i = 0; i < modules.length; i += 1) darkCount += modules[i]!;

  return {
    text,
    version,
    ecLevel,
    mask,
    size,
    modules,
    darkCount,
    isDark: (row: number, col: number) => {
      if (row < 0 || col < 0 || row >= size || col >= size) return false;
      return modules[row * size + col] === 1;
    },
  };
}

function clampVersion(version: number): number {
  if (!Number.isInteger(version) || version < MIN_VERSION || version > MAX_VERSION) {
    throw new RangeError(`版本必须是 ${MIN_VERSION}..${MAX_VERSION} 的整数，收到 ${version}`);
  }
  return version;
}

/** 选能放下的最小版本。 */
function pickVersion(
  byteLength: number,
  ecLevel: QrErrorCorrectionLevel,
  minVersion: number,
  maxVersion: number,
): number {
  for (let version = minVersion; version <= maxVersion; version += 1) {
    const capacityBits = numDataCodewords(version, ecLevel) * 8;
    const usedBits = 4 + byteModeCharCountBits(version) + byteLength * 8;
    if (usedBits <= capacityBits) return version;
  }
  throw new RangeError(
    `数据太长：${byteLength} 字节在版本 ${minVersion}..${maxVersion} / 纠错等级 ${ecLevel} 下放不下`,
  );
}

/** 构造数据码字：模式 + 计数 + 数据 + 终止符 + 补齐 + 填充字节。 */
function buildDataCodewords(
  bytes: ArrayLike<number>,
  version: number,
  ecLevel: QrErrorCorrectionLevel,
): Uint8Array {
  const capacityBits = numDataCodewords(version, ecLevel) * 8;
  const bits: number[] = [];

  const pushBits = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i -= 1) bits.push((value >>> i) & 1);
  };

  pushBits(MODE_BYTE, 4);
  pushBits(bytes.length, byteModeCharCountBits(version));
  for (let i = 0; i < bytes.length; i += 1) pushBits(bytes[i]! & 0xff, 8);

  // 终止符：最多 4 个 0
  pushBits(0, Math.min(4, capacityBits - bits.length));
  // 补齐到字节边界
  pushBits(0, (8 - (bits.length % 8)) % 8);
  // 交替填充 0xEC / 0x11
  for (let padByte = 0xec; bits.length < capacityBits; padByte ^= 0xec ^ 0x11) {
    pushBits(padByte, 8);
  }

  const result = new Uint8Array(capacityBits / 8);
  for (let i = 0; i < bits.length; i += 1) {
    if (bits[i]) result[i >>> 3] = result[i >>> 3]! | (0x80 >>> (i & 7));
  }
  return result;
}

/** 分块、算纠错、按规范交错。 */
function addEccAndInterleave(
  data: Uint8Array,
  version: number,
  ecLevel: QrErrorCorrectionLevel,
): Uint8Array {
  const numBlocks = NUM_EC_BLOCKS[ecLevel][version]!;
  const blockEccLen = ECC_CODEWORDS_PER_BLOCK[ecLevel][version]!;
  const rawCodewords = Math.floor(rawDataModules(version) / 8);
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
  const shortBlockLen = Math.floor(rawCodewords / numBlocks);

  const divisor = rsGeneratorPolynomial(blockEccLen);
  const blocks: Uint8Array[] = [];

  for (let i = 0, offset = 0; i < numBlocks; i += 1) {
    const dataLen = shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1);
    const chunk = data.subarray(offset, offset + dataLen);
    offset += dataLen;

    const ecc = rsRemainder(chunk, divisor);
    // 短块末尾留一个空位，交错时跳过，这样所有"块"长度一致
    const block = new Uint8Array(shortBlockLen + 1);
    block.set(chunk, 0);
    block.set(ecc, block.length - blockEccLen);
    blocks.push(block);
  }

  const result = new Uint8Array(rawCodewords);
  let k = 0;
  const blockLength = blocks[0]!.length;
  for (let i = 0; i < blockLength; i += 1) {
    for (let j = 0; j < blocks.length; j += 1) {
      // 跳过短块的填充位
      if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) {
        result[k] = blocks[j]![i]!;
        k += 1;
      }
    }
  }
  if (k !== rawCodewords) {
    throw new Error(`交错写入了 ${k} 个码字，预期 ${rawCodewords}`);
  }
  return result;
}

// ── 点阵绘制 ────────────────────────────────────────────────────────────

interface Matrix {
  size: number;
  modules: Uint8Array;
  isFunction: Uint8Array;
}

function setFunctionModule(m: Matrix, x: number, y: number, dark: boolean): void {
  if (x < 0 || y < 0 || x >= m.size || y >= m.size) return;
  const index = y * m.size + x;
  m.modules[index] = dark ? 1 : 0;
  m.isFunction[index] = 1;
}

function drawFunctionPatterns(m: Matrix, version: number, ecLevel: QrErrorCorrectionLevel): void {
  const { size } = m;

  // 定时图形
  for (let i = 0; i < size; i += 1) {
    setFunctionModule(m, 6, i, i % 2 === 0);
    setFunctionModule(m, i, 6, i % 2 === 0);
  }

  // 三个定位图形（含分隔符）
  drawFinderPattern(m, 3, 3);
  drawFinderPattern(m, size - 4, 3);
  drawFinderPattern(m, 3, size - 4);

  // 对齐图形
  const positions = alignmentPatternPositions(version);
  const n = positions.length;
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      const isFinderCorner =
        (i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0);
      if (isFinderCorner) continue;
      drawAlignmentPattern(m, positions[i]!, positions[j]!);
    }
  }

  // 格式信息（先用占位值定下模块位置，最终值在掩码选好后再写一次）
  drawFormatBits(m, ecLevel, 0);
  drawVersionBits(m, version);
}

/** 以 (x, y) 为中心画定位图形，切比雪夫距离决定颜色。 */
function drawFinderPattern(m: Matrix, x: number, y: number): void {
  for (let dy = -4; dy <= 4; dy += 1) {
    for (let dx = -4; dx <= 4; dx += 1) {
      const dist = Math.max(Math.abs(dx), Math.abs(dy));
      setFunctionModule(m, x + dx, y + dy, dist !== 2 && dist !== 4);
    }
  }
}

/** 以 (x, y) 为中心画 5x5 对齐图形。 */
function drawAlignmentPattern(m: Matrix, x: number, y: number): void {
  for (let dy = -2; dy <= 2; dy += 1) {
    for (let dx = -2; dx <= 2; dx += 1) {
      setFunctionModule(m, x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }
}

/** 写入两份格式信息。 */
function drawFormatBits(m: Matrix, ecLevel: QrErrorCorrectionLevel, mask: number): void {
  const { size } = m;
  const data = (EC_LEVEL_FORMAT_BITS[ecLevel] << 3) | mask;

  // BCH(15,5) 编码 + 固定掩码 0x5412
  let rem = data;
  for (let i = 0; i < 10; i += 1) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = ((data << 10) | rem) ^ 0x5412;

  const bit = (i: number) => ((bits >>> i) & 1) !== 0;

  // 第一份：左上角
  for (let i = 0; i <= 5; i += 1) setFunctionModule(m, 8, i, bit(i));
  setFunctionModule(m, 8, 7, bit(6));
  setFunctionModule(m, 8, 8, bit(7));
  setFunctionModule(m, 7, 8, bit(8));
  for (let i = 9; i < 15; i += 1) setFunctionModule(m, 14 - i, 8, bit(i));

  // 第二份：右上 + 左下
  for (let i = 0; i < 8; i += 1) setFunctionModule(m, size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i += 1) setFunctionModule(m, 8, size - 15 + i, bit(i));
  // 固定的深色模块
  setFunctionModule(m, 8, size - 8, true);
}

/** 版本信息，仅版本 ≥ 7 有。 */
function drawVersionBits(m: Matrix, version: number): void {
  if (version < 7) return;

  // BCH(18,6) 编码
  let rem = version;
  for (let i = 0; i < 12; i += 1) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  const bits = (version << 12) | rem;

  for (let i = 0; i < 18; i += 1) {
    const dark = ((bits >>> i) & 1) !== 0;
    const a = m.size - 11 + (i % 3);
    const b = Math.floor(i / 3);
    setFunctionModule(m, a, b, dark);
    setFunctionModule(m, b, a, dark);
  }
}

/** 之字形填充数据位。 */
function drawCodewords(m: Matrix, codewords: Uint8Array): void {
  const { size } = m;
  const totalBits = codewords.length * 8;
  let i = 0;

  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // 跳过竖直定时图形所在列
    for (let vert = 0; vert < size; vert += 1) {
      for (let j = 0; j < 2; j += 1) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        const index = y * size + x;
        if (m.isFunction[index] === 0 && i < totalBits) {
          m.modules[index] = (codewords[i >>> 3]! >>> (7 - (i & 7))) & 1;
          i += 1;
        }
      }
    }
  }
}

/** 掩码函数：返回 true 表示该位置需要取反。 */
function maskPredicate(mask: number, x: number, y: number): boolean {
  switch (mask) {
    case 0:
      return (x + y) % 2 === 0;
    case 1:
      return y % 2 === 0;
    case 2:
      return x % 3 === 0;
    case 3:
      return (x + y) % 3 === 0;
    case 4:
      return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5:
      return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6:
      return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    case 7:
      return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
    default:
      throw new RangeError(`掩码必须是 0..7，收到 ${mask}`);
  }
}

/**
 * 施加掩码。只对数据模块取反，功能图形始终不动。
 *
 * 掩码是自逆运算，同一掩码施加两次即还原，因此试掩码时可以直接来回切。
 */
function applyMask(m: Matrix, mask: number): void {
  const { size, modules, isFunction } = m;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = y * size + x;
      if (isFunction[index] === 0 && maskPredicate(mask, x, y)) {
        modules[index] = modules[index]! ^ 1;
      }
    }
  }
}

const PENALTY_N1 = 3;
const PENALTY_N2 = 3;
const PENALTY_N3 = 40;
const PENALTY_N4 = 10;

/**
 * 依次试 8 个掩码，取罚分最低的。
 *
 * 每次试之前重新写一遍格式信息——格式信息本身参与罚分计算，
 * 而它是随掩码变化的。
 */
function chooseMask(m: Matrix, ecLevel: QrErrorCorrectionLevel): number {
  let bestMask = 0;
  let bestPenalty = Number.POSITIVE_INFINITY;

  for (let mask = 0; mask < 8; mask += 1) {
    applyMask(m, mask);
    drawFormatBits(m, ecLevel, mask);
    const penalty = penaltyScore(m);
    if (penalty < bestPenalty) {
      bestPenalty = penalty;
      bestMask = mask;
    }
    applyMask(m, mask); // 逆运算还原
  }
  return bestMask;
}

/**
 * 标准四条罚分规则合计。
 *
 * 口径说明：规则 3（疑似定位图形）这里采用**11 位滑动窗口**判定，
 * 即匹配 `10111010000` 或 `00001011101`，且不把静区算作那 4 个浅色模块。
 * 另一种常见写法是给每行/列两端补一段虚拟静区再做游程匹配，两者在贴边位置
 * 会给出不同结果——规范对此没有唯一解释，主流实现（含 ZXing 与 node-qrcode）
 * 都用窗口写法。
 *
 * 这**只影响 8 个掩码里选哪个**，任何一个掩码产出的都是合法可扫的二维码。
 * 选窗口写法的实际理由是：能和成熟实现逐位对拍，从而证明整条编码链路正确。
 */
function penaltyScore(m: Matrix): number {
  return penaltyN1(m) + penaltyN2(m) + penaltyN3(m) + penaltyN4(m);
}

/** 规则 1：行/列中连续同色模块，长度 L ≥ 5 时罚 3 + (L - 5)。 */
function penaltyN1(m: Matrix): number {
  const { size, modules } = m;
  let points = 0;

  for (let row = 0; row < size; row += 1) {
    let lastHorizontal = -1;
    let horizontalRun = 0;
    let lastVertical = -1;
    let verticalRun = 0;

    for (let col = 0; col < size; col += 1) {
      const horizontal = modules[row * size + col]!;
      if (horizontal === lastHorizontal) {
        horizontalRun += 1;
      } else {
        if (horizontalRun >= 5) points += PENALTY_N1 + (horizontalRun - 5);
        lastHorizontal = horizontal;
        horizontalRun = 1;
      }

      const vertical = modules[col * size + row]!;
      if (vertical === lastVertical) {
        verticalRun += 1;
      } else {
        if (verticalRun >= 5) points += PENALTY_N1 + (verticalRun - 5);
        lastVertical = vertical;
        verticalRun = 1;
      }
    }

    if (horizontalRun >= 5) points += PENALTY_N1 + (horizontalRun - 5);
    if (verticalRun >= 5) points += PENALTY_N1 + (verticalRun - 5);
  }

  return points;
}

/** 规则 2：2x2 同色块，每块罚 3。 */
function penaltyN2(m: Matrix): number {
  const { size, modules } = m;
  let blocks = 0;

  for (let row = 0; row < size - 1; row += 1) {
    for (let col = 0; col < size - 1; col += 1) {
      const sum =
        modules[row * size + col]! +
        modules[row * size + col + 1]! +
        modules[(row + 1) * size + col]! +
        modules[(row + 1) * size + col + 1]!;
      if (sum === 4 || sum === 0) blocks += 1;
    }
  }

  return blocks * PENALTY_N2;
}

/** 规则 3：行/列中出现 1:1:3:1:1 且一侧有 4 个浅色模块，每处罚 40。 */
function penaltyN3(m: Matrix): number {
  const { size, modules } = m;
  let points = 0;

  for (let row = 0; row < size; row += 1) {
    let windowHorizontal = 0;
    let windowVertical = 0;
    for (let col = 0; col < size; col += 1) {
      windowHorizontal = ((windowHorizontal << 1) & 0x7ff) | modules[row * size + col]!;
      if (col >= 10 && (windowHorizontal === 0x5d0 || windowHorizontal === 0x05d)) points += 1;

      windowVertical = ((windowVertical << 1) & 0x7ff) | modules[col * size + row]!;
      if (col >= 10 && (windowVertical === 0x5d0 || windowVertical === 0x05d)) points += 1;
    }
  }

  return points * PENALTY_N3;
}

/** 规则 4：深色模块占比偏离 50%，每 5% 罚 10。 */
function penaltyN4(m: Matrix): number {
  let dark = 0;
  const total = m.modules.length;
  for (let i = 0; i < total; i += 1) dark += m.modules[i]!;
  const k = Math.abs(Math.ceil(dark * 100 / total / 5) - 10);
  return k * PENALTY_N4;
}
