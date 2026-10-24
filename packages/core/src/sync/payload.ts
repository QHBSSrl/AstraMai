/**
 * 同步载荷：配对码 + PIN 搬数据的**格式**和**加密参数**。
 *
 * ── 这个模块存在的唯一理由 ──────────────────────────────────────────
 *
 * 数据要在**两个完全不同的运行时**之间搬：
 *
 *     手表（Vela 的 @system.crypto）  ↔  浏览器（WebCrypto）
 *
 * 而它们的 API 长得完全不一样。如果两边各写一套"密钥怎么算"，
 * **一定会算出不同的字节** —— 表现是解密后全是乱码，
 * 而且极难查（两边代码各自看起来都对）。
 *
 * 所以：**参数推导放在这里，两边都调它。** 只写一遍，就不可能不一致。
 *
 * ── 为什么不用 SHA 派生密钥 ────────────────────────────────────────
 *
 * 想用 `sha256(pin + code)` 当密钥更安全，但有两个实际情况：
 *
 *  1. Worker 端**存的就是** `sha256(pin + code)` —— 用它当密钥等于
 *     把密钥也存进了 KV。KV 一旦泄露，数据全解。
 *  2. 手表的 `hashDigest` 返回格式文档没写死（可能是 hex 也可能是 base64），
 *     项目里 `secret.js` 专门写了 `normalizeDigest` 来兼容 ——
 *     把它掺进加密链路，多一个会静默出错的地方。
 *
 * 所以走最简单、最不可能出错的路：**直接拼字节**。
 *
 * ⚠️ **安全边界（必须清楚）**：
 * 密钥空间只有 PIN 的 **10⁴**。这不是强加密，是**"防止旁边人看到"**。
 * 真正的门是那 6 位配对码（10⁶，屏幕上显示一次）+ 10 分钟 TTL +
 * Worker 端每 IP 20 次/分的限流。
 *
 * **不要用这个东西搬真正机密的数据。**
 */

/** 载荷格式版本。改结构时必须递增，旧数据会被解码拒掉。 */
export const SYNC_VERSION = 1;

/** AES 密钥长度（字节）。手表和浏览器都必须用 16 字节 = AES-128。 */
export const KEY_BYTES = 16;

/** 载荷的包装。 */
export interface SyncPayload {
  /** 格式版本。 */
  version: number;
  /** 游戏 id，如 `maimai`。 */
  game: string;
  /** 生成时间（ISO 字符串）。 */
  createdAt: string;
  /** 原始视图数据（B50View 等）。不解构、不校验内容。 */
  view: unknown;
}

/**
 * 把明文补到指定字节长度的 ASCII（右侧补 `'0'`）。
 *
 * 超过长度直接截断 —— 不抛异常，因为 PIN 和 code 的长度已经在
 * `validatePin` / `validateCode` 里卡过了，这里只做兜底。
 */
function padAscii(text: string, bytes: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < bytes; i += 1) {
    // 只取 charCode 的低 8 位 —— 输入全是数字，不会有非 ASCII
    out.push(i < text.length ? text.charCodeAt(i) & 0xff : 0x30);
  }
  return out;
}

/** 字节数组 → 标准 base64（带 `=` 填充）。 */
export function bytesToBase64(bytes: readonly number[]): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';

  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] ?? 0;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];

    out += alphabet[b0 >> 2];
    out += alphabet[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)];
    out += b1 === undefined ? '=' : alphabet[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)];
    out += b2 === undefined ? '=' : alphabet[b2 & 0x3f];
  }

  return out;
}

/** base64 → 字节数组。解码失败抛异常。 */
export function base64ToBytes(text: string): number[] {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = text.replace(/=+$/, '');
  const out: number[] = [];

  let buffer = 0;
  let bits = 0;

  for (const ch of clean) {
    const value = alphabet.indexOf(ch);
    if (value < 0) throw new Error(`base64 里有非法字符：${ch}`);

    buffer = (buffer << 6) | value;
    bits += 6;

    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 0xff);
    }
  }

  return out;
}

/** PIN 必须是 4 位数字。 */
export function isValidPin(pin: unknown): pin is string {
  return typeof pin === 'string' && /^\d{4}$/.test(pin);
}

/** 配对码必须是 6 位数字。 */
export function isValidCode(code: unknown): code is string {
  return typeof code === 'string' && /^\d{6}$/.test(code);
}

/**
 * 派生 AES 密钥（base64，16 字节）。
 *
 * 输入是 **PIN + 配对码** 拼起来：Worker 知道 code 但**不知道 PIN**，
 * 所以它拿不到这个密钥 —— 这是整条链路唯一真正的秘密。
 */
export function deriveKeyBase64(pin: string, code: string): string {
  if (!isValidPin(pin)) throw new Error('PIN 必须是 4 位数字');
  if (!isValidCode(code)) throw new Error('配对码必须是 6 位数字');

  return bytesToBase64(padAscii(`${pin}${code}`, KEY_BYTES));
}

/**
 * 派生 AES 的 IV（base64，16 字节）。
 *
 * **用配对码派生的原因**：手表的 `@system.crypto` **没有随机数接口**，
 * 生成不了随机 IV。而配对码本身就是 Worker 随机生成的 6 位数，
 * 每次同步都不同 —— 正好补上这个空缺。
 *
 * 代价：同一个配对码的 IV 固定。但一个配对码只用一次（10 分钟后过期），
 * 所以等价于每次加密都用新 IV。
 */
export function deriveIvBase64(code: string): string {
  if (!isValidCode(code)) throw new Error('配对码必须是 6 位数字');

  return bytesToBase64(padAscii(code, KEY_BYTES));
}

/**
 * 打包成要上传的明文（**还没加密**）。
 *
 * 明文里不放任何"额外元数据" —— 越少字段，两个运行时之间的差异面越小。
 */
export function encodeSyncPayload(
  game: string,
  view: unknown,
  now: Date = new Date(),
): string {
  const payload: SyncPayload = {
    version: SYNC_VERSION,
    game,
    createdAt: now.toISOString(),
    view,
  };

  return JSON.stringify(payload);
}

/**
 * 解包并校验。
 *
 * 校验的是**结构**，不是内容 —— `view` 原样返回，由调用方决定怎么用。
 * 版本不对直接抛：拿错版本的数据继续用，比报错更糟。
 */
export function decodeSyncPayload(raw: string): SyncPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('同步数据不是合法 JSON');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('同步数据不是一个对象');
  }

  const candidate = parsed as Partial<SyncPayload>;

  if (candidate.version !== SYNC_VERSION) {
    throw new Error(`同步数据版本是 ${String(candidate.version)}，本版本只认 ${SYNC_VERSION}`);
  }
  if (typeof candidate.game !== 'string' || !candidate.game) {
    throw new Error('同步数据缺少游戏标识');
  }
  if (typeof candidate.createdAt !== 'string') {
    throw new Error('同步数据缺少生成时间');
  }

  return {
    version: candidate.version,
    game: candidate.game,
    createdAt: candidate.createdAt,
    view: candidate.view,
  };
}
