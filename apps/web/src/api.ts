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
