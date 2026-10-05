/**
 * 华立（Wahlap）机台二维码的载荷解析。
 *
 * 用途：拿到的二维码内容是一个 URL，本模块把其中对**使用者有意义**的部分
 * 解析出来——尤其是**有效期**。手表端可以据此显示「还剩几分几秒」，
 * 避免把一张已经过期的码举给机台。
 *
 * 实测样本（舞萌DX / 中二节奏 登入二维码）：
 *
 * ```
 * https://wq.wahlap.net/qrcode/req/MAID<12位时间戳><64位十六进制令牌>.html
 *   ?l=<10位过期秒级时间戳>
 *   &t=<十六进制编码的标题>
 *   &d=<十六进制编码的提示文案>
 * ```
 *
 * 注意：本模块只做**解析与展示**。它不会、也不应该去访问该 URL 或其背后的服务；
 * 二维码本身就是一张登入凭据，谁拿到都能用，因此调用方不应把原文落盘或上报。
 */

import { decodeHexUtf8 } from '../util/utf8.js';

/** 识别到的二维码用途。 */
export type WahlapQrKind = 'login' | 'unknown';

export interface WahlapQrPayload {
  /** 原始 URL。 */
  readonly raw: string;
  /** 主机名，例如 `wq.wahlap.net`。 */
  readonly host: string;
  /** 用途判断：`login` 表示机台登入二维码。 */
  readonly kind: WahlapQrKind;
  /** 由文件名前缀判断的目标机种，例如 `MAID`。 */
  readonly prefix: string | null;
  /** 生成时刻（若文件名里的时间戳可解析）。 */
  readonly generatedAt: Date | null;
  /** 过期时刻（由 `l` 参数解析）。 */
  readonly expiresAt: Date | null;
  /** 有效时长（毫秒）；需要同时有生成与过期时刻。 */
  readonly validForMs: number | null;
  /** 标题，来自 `t` 参数（十六进制 UTF-8）。 */
  readonly title: string | null;
  /** 提示文案，来自 `d` 参数（十六进制 UTF-8）。 */
  readonly description: string | null;
  /**
   * 令牌摘要——**只够用来区分不同的码，不足以重建 URL**。
   * 形如 `012345…CDEF(64)`。
   */
  readonly tokenPreview: string | null;
  /** 是否被识别为华立机台二维码。 */
  readonly recognized: boolean;
}

const WAHLAP_HOST_PATTERN = /(^|\.)wahlap\.(net|com)$/i;
const QR_PATH_PATTERN = /^\/qrcode\/req\/([A-Za-z0-9]+)\.html$/i;
/** 文件名 = 字母前缀 + 12 位时间戳 + 十六进制令牌。 */
const FILE_NAME_PATTERN = /^([A-Z]{2,8})(\d{12})([0-9A-Fa-f]+)$/;

/**
 * 解析二维码内容。
 *
 * @returns 解析结果；输入不是合法 URL 时返回 `null`。
 */
export function parseWahlapQrPayload(input: string): WahlapQrPayload | null {
  const raw = input.trim();
  if (!/^https?:\/\//i.test(raw)) return null;

  const match = /^https?:\/\/([^/?#]+)([^?#]*)(?:\?([^#]*))?/i.exec(raw);
  if (!match) return null;

  const host = match[1] ?? '';
  const path = match[2] ?? '';
  const query = match[3] ?? '';

  const params = parseQuery(query);
  const pathMatch = QR_PATH_PATTERN.exec(path);
  const fileName = pathMatch?.[1] ?? null;
  const nameMatch = fileName ? FILE_NAME_PATTERN.exec(fileName) : null;

  let generatedAt: Date | null = null;
  if (nameMatch?.[2]) {
    generatedAt = parseCompactTimestamp(nameMatch[2]);
  }

  const expiresAt = parseUnixSeconds(params.get('l'));
  const token = nameMatch?.[3] ?? null;

  const recognized = WAHLAP_HOST_PATTERN.test(host) && fileName !== null;

  return {
    raw,
    host,
    kind: recognized ? 'login' : 'unknown',
    prefix: nameMatch?.[1] ?? null,
    generatedAt,
    expiresAt,
    validForMs:
      generatedAt && expiresAt ? expiresAt.getTime() - generatedAt.getTime() : null,
    title: decodeHexParam(params.get('t')),
    description: decodeHexParam(params.get('d')),
    tokenPreview: token ? `${token.slice(0, 6)}…${token.slice(-4)}(${token.length})` : null,
    recognized,
  };
}

/**
 * 相对当前时刻的有效状态。
 * 手表端可以在每次亮屏时重算，不需要额外的网络请求。
 */
export function describeValidity(
  payload: WahlapQrPayload,
  now: Date = new Date(),
): { state: 'valid' | 'expired' | 'unknown'; remainingMs: number | null; text: string } {
  if (!payload.expiresAt) {
    return { state: 'unknown', remainingMs: null, text: '无法判断有效期' };
  }
  const remainingMs = payload.expiresAt.getTime() - now.getTime();
  if (remainingMs <= 0) {
    return { state: 'expired', remainingMs: 0, text: '二维码已过期，请在微信小程序里重新生成' };
  }
  return {
    state: 'valid',
    remainingMs,
    text: `剩余有效时间 ${formatDuration(remainingMs)}`,
  };
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
 * ⚠️ 这里必须按**北京时间（UTC+8）**解释，不能按运行环境的本地时区。
 *
 * 依据：实测样本里文件名中的 12 位时间是**东八区墙上时间**，
 * 而 `l` 是绝对 Unix 时间戳；两者换算出的时刻相差一个固定的有效期
 * （实测约 10 分钟）。若按运行环境本地时区解释文件名，在非东八区的机器上
 * 算出的有效期会整体偏移——本机在 UTC+8 时看不出来，跑到 CI 上就错了。
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
