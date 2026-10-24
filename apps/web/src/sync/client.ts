/**
 * 同步服务的 HTTP 客户端。
 *
 * 契约来自 `astramai-sync`（GLM 写的 Worker，19 条测试验过）。
 *
 * ── base URL 为什么是可配置的 ──────────────────────────────────────
 *
 * Worker 还没部署（wrangler 没登录，要用户自己的 Cloudflare 账号）。
 * 所以不能把域名写死 —— 部署完在设置里填进去，或者打构建时从
 * `import.meta.env` 读。
 *
 * 写死一个还没上线的域名，表现是"点了没反应"，比"没配置"更难查。
 */

/** 默认的 Worker 地址。部署后改这里，或在设置里覆盖。 */
/**
 * 直连 Cloudflare Worker（自定义域）。
 *
 * Worker 已经带 CORS 头了（2026-10-24 加的），浏览器可以跨域调用，
 * **不需要任何反代**。
 *
 * ⚠️ 不要用 workers.dev 那个 —— 已禁用，而且国内 DNS 被污染。
 */
const DEFAULT_BASE_URL = 'https://worksync.astramai.astranexus.cn';

/** 本地 `wrangler dev` 的地址（开发时用）。 */
export const LOCAL_BASE_URL = 'http://127.0.0.1:8787';

const STORAGE_KEY = 'astramai:sync:baseUrl';

/** 读配置的 base URL；没配置就用默认。 */
export function readBaseUrl(): string {
  try {
    return window.localStorage.getItem(STORAGE_KEY)?.trim() || DEFAULT_BASE_URL;
  } catch {
    return DEFAULT_BASE_URL;
  }
}

/** 写入 base URL（去掉末尾斜杠，否则拼出来会是 `//sync/create`）。 */
export function writeBaseUrl(url: string): void {
  try {
    const trimmed = url.trim().replace(/\/+$/, '');
    if (trimmed) window.localStorage.setItem(STORAGE_KEY, trimmed);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 隐私模式写不了，忽略 —— 下次还是用默认值
  }
}

/** 同步接口的错误。`code` 是 Worker 返回的 snake_case error。 */
export class SyncError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number) {
    super(syncErrorMessage(code, status));
    this.name = 'SyncError';
    this.code = code;
    this.status = status;
  }
}

/**
 * 把 Worker 的 error 码翻成人话。
 *
 * 手表屏幕小，`pin_mismatch` 这种直接显示出来没人看得懂。
 */
function syncErrorMessage(code: string, status: number): string {
  switch (code) {
    case 'pin_mismatch':
      return 'PIN 不对';
    case 'not_found':
      return '配对码不存在或已过期';
    case 'not_uploaded':
      return '对方还没上传数据';
    case 'expired':
      return '已过期，重新生成配对码';
    case 'too_large':
      return '数据太大，超过 256 KB';
    case 'rate_limited':
      return '请求太频繁，等一分钟再试';
    case 'invalid_pin':
      return 'PIN 格式不对（要 4 位数字）';
    case 'invalid_payload':
      return '数据格式不对';
    default:
      return `同步服务出错（${code || status}）`;
  }
}

interface CreateResponse {
  ok: true;
  code: string;
  expiresAt: number;
}

interface GetResponse {
  ok: true;
  payload: string;
  expiresAt: number;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const base = readBaseUrl();
  const url = `${base}${path}`;

  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    // 网络层失败（断网 / 域名不对 / CORS）—— 和业务错误分开说
    throw new SyncError('network', 0);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new SyncError('bad_response', response.status);
  }

  if (!response.ok || (body as { ok?: boolean })?.ok !== true) {
    const code = (body as { error?: string })?.error ?? 'unknown';
    throw new SyncError(code, response.status);
  }

  return body as T;
}

/** 创建配对码。PIN 由调用方生成（4 位数字）。 */
export function createSyncCode(pin: string): Promise<CreateResponse> {
  return request<CreateResponse>('/sync/create', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pin }),
  });
}

/** 上传加密后的载荷。 */
export function putSyncPayload(
  code: string,
  pin: string,
  payload: string,
): Promise<{ ok: true; expiresAt?: number }> {
  return request(`/sync/${code}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pin, payload }),
  });
}

/** 拉取加密后的载荷。 */
export function getSyncPayload(code: string, pin: string): Promise<GetResponse> {
  return request<GetResponse>(`/sync/${encodeURIComponent(code)}?pin=${encodeURIComponent(pin)}`);
}

/** 健康检查 —— 设置页用来测"填的地址对不对"。 */
export function checkSyncHealth(): Promise<{ ok: true; service: string; version: string }> {
  return request('/health');
}
