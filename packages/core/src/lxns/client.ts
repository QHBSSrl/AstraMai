/**
 * 落雪 API 客户端。
 *
 * 刻意只依赖「结构上的 fetch」而非 DOM 或 Node 的具体实现，
 * 以便同一份代码在 Node、浏览器与 Vela QuickApp 中复用。
 */

import { LXNS_API_BASE, maimaiEndpoints, type SongListQuery } from './endpoints.js';
import { LxnsError, kindFromStatus } from './errors.js';
import type {
  ApiEnvelope,
  MaimaiAliasList,
  MaimaiBests,
  MaimaiPlayer,
  MaimaiRatingTrend,
  MaimaiScore,
  MaimaiSimpleScore,
  MaimaiSong,
  MaimaiSongList,
} from './types.js';

// ── 最小可移植的 fetch 契约 ─────────────────────────────────────────────

export interface HttpResponseLike {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

export interface RequestInitLike {
  method?: string;
  headers?: Record<string, string>;
  signal?: unknown;
}

export type FetchLike = (url: string, init?: RequestInitLike) => Promise<HttpResponseLike>;

export interface LxnsClientOptions {
  /** 开发者 API 密钥，作为 `Authorization` 头发送。 */
  developerKey?: string | undefined;
  /** 个人 API 密钥，作为 `X-User-Token` 头发送。 */
  userToken?: string | undefined;
  /** 覆盖基础 URL（测试或自建反代时使用）。 */
  baseUrl?: string | undefined;
  /** 自定义 fetch 实现；默认取 `globalThis.fetch`。 */
  fetchImpl?: FetchLike | undefined;
  /** 单次请求超时（毫秒），默认 15000。 */
  timeoutMs?: number | undefined;
}

/**
 * 落雪部分接口带 `{success, code, message, data}` 包装，部分（公共接口）
 * 直接返回裸对象。这里统一解包，两种都能用。
 */
export function unwrapEnvelope<T>(payload: unknown, endpoint = ''): T {
  if (payload === null || typeof payload !== 'object') {
    throw new LxnsError('malformed', `响应不是 JSON 对象：${endpoint}`, { endpoint });
  }
  if ('success' in payload && 'data' in payload) {
    const envelope = payload as ApiEnvelope<T>;
    if (!envelope.success) {
      const detail = envelope.message ?? '';
      const kind = kindFromStatus(envelope.code ?? 0);
      throw new LxnsError(kind, detail || `落雪返回失败：${endpoint}`, {
        status: envelope.code ?? 0,
        detail,
        endpoint,
      });
    }
    if (envelope.data === null || envelope.data === undefined) {
      throw new LxnsError('malformed', `响应 data 为空：${endpoint}`, { endpoint });
    }
    return envelope.data;
  }
  return payload as T;
}

/** 默认 fetch：绑定到全局对象，避免丢失 `this`。 */
function defaultFetch(): FetchLike {
  const impl = (globalThis as { fetch?: unknown }).fetch;
  if (typeof impl !== 'function') {
    throw new LxnsError('network', '当前运行环境没有可用的 fetch 实现，请传入 fetchImpl。');
  }
  return impl.bind(globalThis) as FetchLike;
}

export class LxnsClient {
  readonly baseUrl: string;
  private readonly developerKey: string | undefined;
  private readonly userToken: string | undefined;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(options: LxnsClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? LXNS_API_BASE).replace(/\/+$/, '');
    this.developerKey = options.developerKey?.trim() || undefined;
    this.userToken = options.userToken?.trim() || undefined;
    this.fetchImpl = options.fetchImpl ?? defaultFetch();
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  /** 是否已具备开发者密钥。 */
  get hasDeveloperKey(): boolean {
    return this.developerKey !== undefined;
  }

  /** 是否已具备个人密钥。 */
  get hasUserToken(): boolean {
    return this.userToken !== undefined;
  }

  /** 发起 GET 请求并解包。 */
  async request<T>(path: string, init: { method?: string } = {}): Promise<T> {
    const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
    const headers: Record<string, string> = { accept: 'application/json' };
    if (this.developerKey) headers.authorization = this.developerKey;
    if (this.userToken) headers['x-user-token'] = this.userToken;

    const controller = typeof AbortController === 'function' ? new AbortController() : undefined;
    const timer =
      controller && this.timeoutMs > 0
        ? setTimeout(() => controller.abort(), this.timeoutMs)
        : undefined;

    let response: HttpResponseLike;
    try {
      response = await this.fetchImpl(url, {
        method: init.method ?? 'GET',
        headers,
        ...(controller ? { signal: controller.signal } : {}),
      });
    } catch (error) {
      if (error instanceof LxnsError) throw error;
      const aborted = isAbortError(error);
      throw new LxnsError(aborted ? 'timeout' : 'network', `${aborted ? '请求超时' : '网络请求失败'}：${path}`, {
        endpoint: path,
        cause: error,
      });
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }

    const text = await response.text();
    let parsed: unknown;
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

    if (!response.ok) {
      const detail =
        parsed && typeof parsed === 'object' && 'message' in parsed
          ? String((parsed as { message?: unknown }).message ?? '')
          : '';
      const kind = kindFromStatus(response.status);
      throw new LxnsError(kind, detail || `HTTP ${response.status}：${path}`, {
        status: response.status,
        detail,
        endpoint: path,
      });
    }

    return unwrapEnvelope<T>(parsed, path);
  }

  // ── 具体接口 ──────────────────────────────────────────────────────────

  getPlayer(friendCode: number | string): Promise<MaimaiPlayer> {
    return this.request<MaimaiPlayer>(maimaiEndpoints.player(friendCode));
  }

  getPlayerByQq(qq: number | string): Promise<MaimaiPlayer> {
    return this.request<MaimaiPlayer>(maimaiEndpoints.playerByQq(qq));
  }

  /** 获取玩家缓存的 Best 50。 */
  getBests(friendCode: number | string): Promise<MaimaiBests> {
    return this.request<MaimaiBests>(maimaiEndpoints.bests(friendCode));
  }

  /** 获取玩家缓存的 All Perfect 50。 */
  getBestsAp(friendCode: number | string): Promise<MaimaiBests> {
    return this.request<MaimaiBests>(maimaiEndpoints.bestsAp(friendCode));
  }

  /** 单曲全部难度成绩。 */
  getSongScores(
    friendCode: number | string,
    query: { song_id?: number; song_name?: string; song_type?: string },
  ): Promise<MaimaiScore[]> {
    return this.request<MaimaiScore[]>(maimaiEndpoints.songScores(friendCode, query));
  }

  /** Recent 50。 */
  getRecents(friendCode: number | string): Promise<MaimaiScore[]> {
    return this.request<MaimaiScore[]>(maimaiEndpoints.recents(friendCode));
  }

  /** 全部最佳成绩（简化）。 */
  getScores(friendCode: number | string): Promise<MaimaiSimpleScore[]> {
    return this.request<MaimaiSimpleScore[]>(maimaiEndpoints.scores(friendCode));
  }

  /** DX Rating 趋势。 */
  getTrend(friendCode: number | string, version?: number): Promise<MaimaiRatingTrend[]> {
    return this.request<MaimaiRatingTrend[]>(maimaiEndpoints.trend(friendCode, version));
  }

  /** 成绩上传热力图：日期 → 数量。 */
  getHeatmap(friendCode: number | string): Promise<Record<string, number>> {
    return this.request<Record<string, number>>(maimaiEndpoints.heatmap(friendCode));
  }

  /** 曲目列表（公共接口，无需鉴权）。 */
  getSongList(query: SongListQuery = {}): Promise<MaimaiSongList> {
    return this.request<MaimaiSongList>(maimaiEndpoints.songList(query));
  }

  /** 单曲信息（公共接口）。 */
  getSong(songId: number | string, version?: number): Promise<MaimaiSong> {
    return this.request<MaimaiSong>(maimaiEndpoints.song(songId, version));
  }

  /** 曲目别名列表（公共接口）。 */
  getAliasList(): Promise<MaimaiAliasList> {
    return this.request<MaimaiAliasList>(maimaiEndpoints.aliasList());
  }
}

function isAbortError(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  const name = (error as { name?: unknown }).name;
  return name === 'AbortError' || name === 'TimeoutError';
}
