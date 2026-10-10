/**
 * Phigros Query 开放平台客户端。
 *
 * 和 `LxnsClient` 的两处结构差异，都在这里抹平：
 *
 *   1. **没有信封。** 落雪是 `{success, code, message, data}`；
 *      Phigros 成功时直接返回数据体，失败时返回 RFC 7807 风格的
 *      `{type, title, status, detail, code, requestId}`。
 *      所以不能复用 `unwrapEnvelope`。
 *
 *   2. **鉴权头不同。** 落雪用 `Authorization`，Phigros 用 `X-OpenApi-Token`。
 *
 * 仍然沿用 `LxnsError` 作为错误类型：调用方（网关、路由）已经有统一的
 * 错误分类与降级逻辑，让它认识一个新错误类比多一套分支更省事。
 */

import { LxnsError } from '../lxns/errors.js';
import type {
  PhigrosQrCode,
  PhigrosQrStatus,
  PhigrosSaveResponse,
  PhigrosSongSearch,
  PhigrosTapTapVersion,
} from './types.js';

/** 开放平台基础 URL。 */
export const PHIGROS_API_BASE = 'https://r0semi.xtower.site/api/v1/open';

/** 兼容 core 的 fetch 形态（与 LxnsClient 一致，便于共用适配器）。 */
export interface PhigrosHttpResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

export type PhigrosFetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<PhigrosHttpResponse>;

export interface PhigrosClientOptions {
  /** 开放平台密钥。缺了就只能跑通公共部分（曲目搜索）。 */
  apiKey?: string | undefined;
  baseUrl?: string | undefined;
  fetchImpl?: PhigrosFetchLike | undefined;
  timeoutMs?: number | undefined;
}

/** 把开放平台的错误体转成 core 统一的错误。 */
function errorFromBody(body: unknown, status: number, path: string): LxnsError {
  const detail =
    body && typeof body === 'object' && 'detail' in body
      ? String((body as { detail?: unknown }).detail ?? '')
      : '';
  const code =
    body && typeof body === 'object' && 'code' in body
      ? String((body as { code?: unknown }).code ?? '')
      : '';

  // 401/403 是「密钥或 scope 不对」，属于配置问题，**不该被降级成假数据**——
  // 和落雪那边区分「上游不可用」与「调用方有问题」是同一个道理
  if (status === 401) {
    return new LxnsError('unauthorized', detail || '开放平台密钥无效或缺失', { status, endpoint: path });
  }
  if (status === 403) {
    return new LxnsError('forbidden', detail || `缺少 scope：${code}`, { status, endpoint: path });
  }
  if (status === 404) {
    return new LxnsError('not-found', detail || '资源不存在', { status, endpoint: path });
  }
  if (status === 422) {
    return new LxnsError('bad-request', detail || '参数校验失败', { status, endpoint: path });
  }
  if (status === 429) {
    // 这是别人托管的服务，限速是常态，单独分类以便网关走退避而不是降级
    return new LxnsError('rate-limited', detail || '开放平台限速', { status, endpoint: path });
  }
  if (status >= 500) {
    return new LxnsError('server', detail || `开放平台返回 ${status}`, { status, endpoint: path });
  }
  return new LxnsError('bad-request', detail || `请求失败（HTTP ${status}）`, { status, endpoint: path });
}

export class PhigrosClient {
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;
  private readonly fetchImpl: PhigrosFetchLike;
  private readonly timeoutMs: number;

  constructor(options: PhigrosClientOptions = {}) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? PHIGROS_API_BASE).replace(/\/$/, '');
    this.timeoutMs = options.timeoutMs ?? 15000;

    const impl = options.fetchImpl ?? (globalThis.fetch as unknown as PhigrosFetchLike | undefined);
    if (typeof impl !== 'function') {
      throw new TypeError('PhigrosClient 需要一个 fetch 实现');
    }
    this.fetchImpl = impl;
  }

  get hasApiKey(): boolean {
    return this.apiKey !== undefined && this.apiKey.length > 0;
  }

  /** 发一次请求并解包。失败一律抛 LxnsError。 */
  private async request<T>(
    path: string,
    init: { method?: string; body?: unknown; extraHeaders?: Record<string, string> } = {},
  ): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (this.apiKey) headers['X-OpenApi-Token'] = this.apiKey;
    if (init.body !== undefined) headers['Content-Type'] = 'application/json';
    Object.assign(headers, init.extraHeaders ?? {});

    let response: PhigrosHttpResponse;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: init.method ?? 'GET',
        headers,
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      });
    } catch (error) {
      if (error instanceof LxnsError) throw error;
      throw new LxnsError('network', `网络请求失败：${path}`, { endpoint: path, cause: error });
    }

    const text = await response.text();
    let parsed: unknown = null;
    try {
      parsed = text.length > 0 ? JSON.parse(text) : null;
    } catch (error) {
      throw new LxnsError('malformed', `响应不是合法 JSON：${path}`, {
        status: response.status,
        detail: text.slice(0, 200),
        endpoint: path,
        cause: error,
      });
    }

    if (!response.ok) throw errorFromBody(parsed, response.status, path);

    // 没有信封：成功就是数据本身
    return parsed as T;
  }

  // ── TapTap 扫码登录 ────────────────────────────────────────────────

  /**
   * 生成 TapTap 登录二维码。
   *
   * ⚠️ 这一步**不需要玩家做什么**，是给玩家扫的。
   * 手表上没有摄像头，所以扫码只能在网页端做。
   */
  createQrCode(taptapVersion: PhigrosTapTapVersion = 'cn'): Promise<PhigrosQrCode> {
    return this.request<PhigrosQrCode>(`/auth/qrcode?taptapVersion=${taptapVersion}`, {
      method: 'POST',
    });
  }

  /**
   * 轮询扫码状态。
   *
   * 打开后用返回的 `retryAfter` 决定下次隔多久再问——
   * **别用固定间隔猛轮询**，这是别人托管的服务。
   */
  pollQrStatus(qrId: string): Promise<PhigrosQrStatus> {
    return this.request<PhigrosQrStatus>(`/auth/qrcode/${encodeURIComponent(qrId)}/status`);
  }

  // ── 成绩 ───────────────────────────────────────────────────────────

  /**
   * 取玩家存档并解析成结构化成绩。
   *
   * @param sessionToken 玩家在 TapTap 扫码后拿到的凭证
   */
  getSave(sessionToken: string, taptapVersion: PhigrosTapTapVersion = 'cn'): Promise<PhigrosSaveResponse> {
    return this.request<PhigrosSaveResponse>('/save?calculate_rks=true', {
      method: 'POST',
      body: { sessionToken, taptapVersion },
    });
  }

  // ── 曲库 ───────────────────────────────────────────────────────────

  /** 曲目搜索。**这是这个平台唯一的曲库入口**，没有全量列表。 */
  searchSongs(query: string, limit = 20): Promise<PhigrosSongSearch> {
    const params = `q=${encodeURIComponent(query)}&limit=${limit}`;
    return this.request<PhigrosSongSearch>(`/songs/search?${params}`);
  }
}
