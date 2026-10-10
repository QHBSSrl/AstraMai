/**
 * 前端 API 客户端。
 *
 * 只和本仓库的服务端说话（开发期由 Vite 代理 /api），永远不直接请求落雪，
 * 因此开发者密钥不会出现在浏览器发出的跨域请求里。
 */

import type { B50View, LxnsErrorKind } from '@astramai/core';

const KEY_STORAGE = 'astramai.developerKey';

/** 查询方式：好友码或已绑定落雪的 QQ 号。 */
export type QueryKind = 'friendCode' | 'qq';

export interface ApiErrorPayload {
  kind: LxnsErrorKind | string;
  message?: string;
  friendlyMessage?: string;
  detail?: string;
  status?: number;
  endpoint?: string;
}

export interface ApiSuccess<T> {
  ok: true;
  data: T;
  mode?: 'live' | 'mock';
  usedServerKey?: boolean;
  librarySource?: 'lxns' | 'synthetic';
  elapsedMs?: number;
  source?: string;
  fetchedAt?: string;
}

export interface ApiFailure {
  ok: false;
  error: ApiErrorPayload;
}

export class ApiError extends Error {
  readonly kind: string;
  readonly friendlyMessage: string;
  readonly detail: string;
  readonly status: number;
  readonly endpoint: string;

  constructor(payload: ApiErrorPayload) {
    const friendly = payload.friendlyMessage ?? '请求失败。';
    super(payload.message ?? friendly);
    this.name = 'ApiError';
    this.kind = String(payload.kind ?? 'unknown');
    this.friendlyMessage = friendly;
    this.detail = payload.detail ?? '';
    this.status = payload.status ?? 0;
    this.endpoint = payload.endpoint ?? '';
  }
}

// ── 开发者密钥（仅本地测试用，存 sessionStorage，关掉标签页即失效） ────────

export function readStoredKey(): string {
  try {
    return sessionStorage.getItem(KEY_STORAGE) ?? '';
  } catch {
    return '';
  }
}

export function writeStoredKey(key: string): void {
  try {
    if (key) sessionStorage.setItem(KEY_STORAGE, key);
    else sessionStorage.removeItem(KEY_STORAGE);
  } catch {
    // 隐私模式下 sessionStorage 可能不可用，忽略即可
  }
}

function authHeaders(): Record<string, string> {
  const key = readStoredKey();
  return key ? { 'x-lxns-key': key } : {};
}

async function request<T>(path: string): Promise<ApiSuccess<T>> {
  let response: Response;
  try {
    response = await fetch(path, { headers: { accept: 'application/json', ...authHeaders() } });
  } catch (error) {
    throw new ApiError({
      kind: 'network',
      friendlyMessage: '连不上本地服务端，请确认 npm run dev 正在运行。',
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    throw new ApiError({
      kind: 'malformed',
      friendlyMessage: '服务端返回了无法解析的内容。',
      detail: text.slice(0, 300),
      status: response.status,
    });
  }

  if (parsed && typeof parsed === 'object' && 'ok' in parsed) {
    const payload = parsed as ApiSuccess<T> | ApiFailure;
    if (payload.ok) return payload;
    throw new ApiError(payload.error ?? { kind: 'unknown' });
  }

  throw new ApiError({
    kind: 'malformed',
    friendlyMessage: `服务端返回了意外的结构（HTTP ${response.status}）。`,
    status: response.status,
  });
}

// ── 接口 ────────────────────────────────────────────────────────────────

export interface HealthInfo {
  service: string;
  mode: 'live' | 'mock' | 'unconfigured';
  modeConfig: 'auto' | 'live' | 'mock';
  hasServerKey: boolean;
  allowClientKey: boolean;
  songCache: { cached: boolean; source: string | null; ageMs: number | null; songCount: number };
  upstream: string;
  time: string;
}

export function getHealth(): Promise<ApiSuccess<HealthInfo>> {
  return request<HealthInfo>('/api/health');
}

export interface B50Query {
  kind: QueryKind;
  value: string;
  /** 强制使用模拟数据（「看演示数据」用）。 */
  mock?: boolean;
}

export async function queryB50(query: B50Query): Promise<ApiSuccess<B50View>> {
  const value = query.value.trim();
  if (!/^\d+$/.test(value)) {
    throw new ApiError({
      kind: 'bad-request',
      friendlyMessage:
        query.kind === 'qq' ? 'QQ 号只能是数字。' : '好友码只能是数字。',
    });
  }
  const suffix = query.mock ? '?mock=1' : '';
  const path =
    query.kind === 'qq'
      ? `/api/maimai/b50/qq/${value}${suffix}`
      : `/api/maimai/b50/${value}${suffix}`;
  return request<B50View>(path);
}

// ── 设备配对：把数据送到手表上 ──────────────────────────────────────────
//
// 为什么需要：手表上没有好用的输入法，让玩家在手表上敲好友码/QQ 号很难受。
// 改成在这里填（键盘舒服），手表凭一个 8 位配对码去取。
//
// ⚠️ 这几个接口的错误响应和其它接口形状不同：格式类错误走 `bad()`，
// 返回顶层 { ok:false, message }（没有 error 对象），所以不能复用上面的 request()。

export interface PairState {
  exists: boolean;
  hasPin: boolean;
  expiresAt: number | null;
}

export interface PairSubmitResult {
  ok: boolean;
  pinSet?: boolean;
  message?: string;
}

/** 配对码的校验结果，供表单即时反馈。 */
export function isWellFormedToken(token: string): boolean {
  return /^\d{8}$/.test(token.trim());
}

async function pairRequest<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: { accept: 'application/json', 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
  } catch (error) {
    throw new ApiError({
      kind: 'network',
      friendlyMessage: '连不上服务端，请检查网络。',
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  const text = await response.text();
  let parsed: { ok?: boolean; message?: string; data?: T } | null = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    throw new ApiError({
      kind: 'malformed',
      friendlyMessage: '服务端返回了无法解析的内容。',
      detail: text.slice(0, 200),
      status: response.status,
    });
  }

  if (!parsed) {
    throw new ApiError({ kind: 'malformed', friendlyMessage: '服务端返回了空内容。', status: response.status });
  }

  // 格式类错误：顶层 message，没有 data
  if (parsed.ok === false && !parsed.data) {
    throw new ApiError({
      kind: 'bad-request',
      friendlyMessage: parsed.message ?? '请求被拒绝。',
      status: response.status,
    });
  }

  return (parsed.data ?? (parsed as unknown)) as T;
}

/** 查这个配对码还活着没有、对应设备有没有开传输密码。 */
export function getPairState(token: string): Promise<PairState> {
  return pairRequest<PairState>(`/api/pair/state?token=${encodeURIComponent(token.trim())}`);
}

/**
 * 把玩家数据提交上去，等手表来取。
 *
 * @param pin 可选的传输密码。首次填写即开启 2FA，之后必填。
 */
export function submitPair(token: string, payload: string, pin?: string): Promise<PairSubmitResult> {
  return pairRequest<PairSubmitResult>('/api/pair/submit', {
    method: 'POST',
    body: JSON.stringify({ token: token.trim(), payload, ...(pin ? { pin } : {}) }),
  });
}
