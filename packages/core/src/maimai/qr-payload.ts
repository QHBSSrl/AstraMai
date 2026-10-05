/**
 * 华立（Wahlap）机台二维码的载荷解析。
 *
 * ── 三种形态，务必分清 ─────────────────────────────────────────────────
 *
 * 1. **二维码内容**（真正要喂给扫码器的东西，84 字符）：
 *
 *        SGWCMAID2401011200000123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF
 *        └──┘└──┘└──────────┘└──────────────────────────────────────────────────────────┘
 *        前缀  机型  12 位时间戳                     32 字节令牌（十六进制）
 *
 *    实测两张官方图中前缀都是 `SGWC`，且**不含有效期字段**。
 *    （上面这串是合成样本：时间戳取整点，令牌是重复的十六进制。）
 *
 * 2. **展示页 URL**（`.html`，带有效期与文案）：
 *
 *        https://wq.wahlap.net/qrcode/req/<上面那串去掉 SGWC>.html
 *          ?l=<过期秒级时间戳>&t=<十六进制标题>&d=<十六进制提示>
 *
 * 3. **图片 URL**（`.png`，服务端渲染好的二维码图）：
 *
 *        https://wq.wahlap.net/qrcode/img/<同上>.png?v=
 *
 * 三者共用同一个 `<MAID><时间戳><令牌>` 标识，因此**从任意一种都能还原出二维码内容**。
 *
 * ── 实测数据（用于校准）────────────────────────────────────────────────
 *
 * | 项 | 值 |
 * | --- | --- |
 * | 二维码内容 | 84 字符，全部落在字母数字模式字符集内 |
 * | 编码参数 | 版本 4 / 纠错 M / 33×33 模块（字母数字模式） |
 * | 官方 PNG | 200×200 px，码区 198×198，每模块 6 px，静区仅 1 px |
 *
 * 注意最后一行：**官方自己几乎没有留静区**。规范要求 4 个模块，
 * 我们这边渲染时应当留足，不要照抄。
 *
 * ── 本模块的边界 ───────────────────────────────────────────────────────
 *
 * 只做**解析与展示**。它不会去访问这些 URL 或其背后的服务。
 * 二维码本身就是一张登入凭据，谁拿到都能用，因此调用方不应把原文落盘或上报。
 */

import { decodeHexUtf8 } from '../util/utf8.js';

/** 二维码内容里的固定前缀。实测两张官方图均为 `SGWC`，变更时只需改这一处。 */
export const WAHLAP_QR_CONTENT_PREFIX = 'SGWC';

/** 输入形态。 */
export type WahlapQrSource = 'content' | 'html-url' | 'png-url' | 'unknown-url';

export interface WahlapQrPayload {
  /** 原始输入。 */
  readonly raw: string;
  /** 判定出的输入形态。 */
  readonly source: WahlapQrSource;
  /** 是否被识别为华立机台二维码。 */
  readonly recognized: boolean;
  /**
   * **要喂给二维码组件/编码器的内容**。
   *
   * 这一项是本模块存在的主要理由：机台真正读的是这串短内容，
   * 而不是那个几百字符的展示页 URL。把 URL 拿去生成二维码虽然也能扫出东西，
   * 但会得到一张 77×77 的码，在手表这种小屏上根本没法用
   * （正确内容只有 33×33）。
   */
  readonly content: string | null;
  /** `<MAID><12 位时间戳><令牌>`，三种形态共用的标识。 */
  readonly id: string | null;
  /** 机型前缀，实测为 `MAID`。 */
  readonly machinePrefix: string | null;
  /** 内容前缀，实测为 `SGWC`。 */
  readonly contentPrefix: string | null;

  readonly host: string | null;
  /** 由文件名时间戳解析出的生成时刻（北京时间）。 */
  readonly generatedAt: Date | null;
  /** 过期时刻——**只有 `.html` 形态带 `l` 参数，其余形态为 null**。 */
  readonly expiresAt: Date | null;
  /** 有效时长；需要同时有生成与过期时刻。 */
  readonly validForMs: number | null;
  /** 标题，来自 `.html` 的 `t` 参数。 */
  readonly title: string | null;
  /** 提示文案，来自 `.html` 的 `d` 参数。 */
  readonly description: string | null;
  /** 令牌摘要——只够区分不同的码，不足以重建内容。 */
  readonly tokenPreview: string | null;
}

const WAHLAP_HOST_PATTERN = /(^|\.)wahlap\.(net|com)$/i;
/** 文件名：字母前缀 + 12 位时间戳 + 十六进制令牌。 */
const ID_PATTERN = /^([A-Z]{2,8})(\d{12})([0-9A-Fa-f]+)$/;
/** 二维码内容：可选的固定前缀 + ID。 */
const CONTENT_PATTERN = /^(SGWC)?([A-Z]{2,8}\d{12}[0-9A-Fa-f]+)$/;
const HTML_PATH_PATTERN = /\/qrcode\/req\/([A-Za-z0-9]+)\.html$/i;
const PNG_PATH_PATTERN = /\/qrcode\/img\/([A-Za-z0-9]+)\.png$/i;

/**
 * 解析机台二维码。接受三种形态中的任意一种。
 *
 * @returns 解析结果；输入既不是 URL 也不像二维码内容时返回 `null`。
 */
export function parseWahlapQrPayload(input: string): WahlapQrPayload | null {
  const raw = input.trim();
  if (raw.length === 0) return null;

  if (/^https?:\/\//i.test(raw)) return fromUrl(raw);

  const match = CONTENT_PATTERN.exec(raw.toUpperCase());
  if (match) {
    return build({
      raw,
      source: 'content',
      host: null,
      id: match[2] ?? null,
      contentPrefix: WAHLAP_QR_CONTENT_PREFIX,
      params: new Map(),
    });
  }

  return null;
}

/** 由二维码内容或 URL 得到二维码内容本身；拿不到时返回 null。 */
export function wahlapQrContentOf(input: string): string | null {
  return parseWahlapQrPayload(input)?.content ?? null;
}

function fromUrl(raw: string): WahlapQrPayload | null {
  const match = /^https?:\/\/([^/?#]+)([^?#]*)(?:\?([^#]*))?/i.exec(raw);
  if (!match) return null;

  const host = match[1] ?? '';
  const path = match[2] ?? '';
  const params = parseQuery(match[3] ?? '');

  const htmlMatch = HTML_PATH_PATTERN.exec(path);
  const pngMatch = PNG_PATH_PATTERN.exec(path);
  const fileName = htmlMatch?.[1] ?? pngMatch?.[1] ?? null;

  return build({
    raw,
    source: htmlMatch ? 'html-url' : pngMatch ? 'png-url' : 'unknown-url',
    host,
    id: fileName,
    contentPrefix: fileName ? WAHLAP_QR_CONTENT_PREFIX : null,
    params,
  });
}

function build(input: {
  raw: string;
  source: WahlapQrSource;
  host: string | null;
  id: string | null;
  contentPrefix: string | null;
  params: Map<string, string>;
}): WahlapQrPayload {
  const { raw, source, host, id, contentPrefix, params } = input;

  const idMatch = id ? ID_PATTERN.exec(id) : null;
  const machinePrefix = idMatch?.[1] ?? null;
  const stamp = idMatch?.[2] ?? null;
  const token = idMatch?.[3] ?? null;

  const generatedAt = stamp ? parseCompactTimestamp(stamp) : null;
  const expiresAt = parseUnixSeconds(params.get('l'));

  const recognized =
    idMatch !== null &&
    (source === 'content' || (host !== null && WAHLAP_HOST_PATTERN.test(host)));

  return {
    raw,
    source,
    recognized,
    content: contentPrefix && id ? `${contentPrefix}${id}` : null,
    id,
    machinePrefix,
    contentPrefix,
    host,
    generatedAt,
    expiresAt,
    validForMs: generatedAt && expiresAt ? expiresAt.getTime() - generatedAt.getTime() : null,
    title: decodeHexParam(params.get('t')),
    description: decodeHexParam(params.get('d')),
    tokenPreview: token ? `${token.slice(0, 6)}…${token.slice(-4)}(${token.length})` : null,
  };
}

/**
 * 相对当前时刻的有效状态。
 *
 * 注意：`.html` 之外的形态没有有效期字段，此时返回 `unknown`——
 * 我们宁可说"不知道"，也不去猜一个可能错的倒计时。
 */
export function describeValidity(
  payload: WahlapQrPayload,
  now: Date = new Date(),
): { state: 'valid' | 'expired' | 'unknown'; remainingMs: number | null; text: string } {
  if (!payload.expiresAt) {
    return {
      state: 'unknown',
      remainingMs: null,
      text:
        payload.generatedAt
          ? '无法判断有效期（粘贴带 l 参数的 .html 链接才有时效信息）'
          : '无法判断有效期',
    };
  }
  const remainingMs = payload.expiresAt.getTime() - now.getTime();
  if (remainingMs <= 0) {
    return { state: 'expired', remainingMs: 0, text: '二维码已过期，请在微信小程序里重新生成' };
  }
  return { state: 'valid', remainingMs, text: `剩余有效时间 ${formatDuration(remainingMs)}` };
}

/** 毫秒 → `9 分 32 秒` / `45 秒`。 */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes <= 0) return `${seconds} 秒`;
  return `${minutes} 分 ${seconds} 秒`;
}

// ── 内部工具 ────────────────────────────────────────────────────────────

/** 极简查询串解析，不依赖 `URLSearchParams`（保证 Vela 端可用）。 */
function parseQuery(query: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!query) return map;
  for (const pair of query.split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    const key = eq === -1 ? pair : pair.slice(0, eq);
    const value = eq === -1 ? '' : pair.slice(eq + 1);
    map.set(safeDecode(key), safeDecode(value));
  }
  return map;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return value;
  }
}

/**
 * `YYMMDDhhmmss` → Date。
 *
 * ⚠️ 必须按**北京时间（UTC+8）**解释，不能按运行环境的本地时区。
 * 依据：`.html` 的 `l` 是绝对 Unix 时间戳，与文件名里的时间戳换算后
 * 相差一个固定的有效期。按本地时区解释的话，非东八区的机器会整体偏移——
 * 在本机（UTC+8）看不出来，跑到 CI 上就错了。
 */
function parseCompactTimestamp(stamp: string): Date | null {
  if (stamp.length !== 12) return null;
  const year = 2000 + Number(stamp.slice(0, 2));
  const month = Number(stamp.slice(2, 4));
  const day = Number(stamp.slice(4, 6));
  const hour = Number(stamp.slice(6, 8));
  const minute = Number(stamp.slice(8, 10));
  const second = Number(stamp.slice(10, 12));
  if ([year, month, day, hour, minute, second].some((n) => !Number.isFinite(n))) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;

  const CHINA_OFFSET_MS = 8 * 60 * 60 * 1000;
  return new Date(Date.UTC(year, month - 1, day, hour, minute, second) - CHINA_OFFSET_MS);
}

function parseUnixSeconds(value: string | undefined): Date | null {
  if (!value || !/^\d{9,11}$/.test(value)) return null;
  return new Date(Number(value) * 1000);
}

function decodeHexParam(value: string | undefined): string | null {
  if (!value || value.length % 2 !== 0) return null;
  return decodeHexUtf8(value);
}
