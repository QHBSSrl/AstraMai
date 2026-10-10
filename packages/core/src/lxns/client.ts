/**
 * 落雪 API 客户端。
 *
 * 刻意只依赖「结构上的 fetch」而非 DOM 或 Node 的具体实现，
 * 以便同一份代码在 Node、浏览器与 Vela QuickApp 中复用。
 */

import {
  LXNS_API_BASE,
  chunithmEndpoints,
  maimaiEndpoints,
  type SongListQuery,
} from './endpoints.js';
import { LxnsError, kindFromStatus } from './errors.js';
import type {
  ChunithmAliasList,
  ChunithmBestQuery,
  ChunithmBests,
  ChunithmPlayer,
  ChunithmScore,
  ChunithmSongList,
} from './chunithm-types.js';
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
  /**
   * 附加到每个请求的额外头。
   *
   * 用途：本工程的 Vela/Web 客户端其实是打**自建服务端**而不是落雪，
   * 自建服务端有自己的访问令牌，用这个字段带上即可，
   * 不必把访问令牌硬塞进语义上是「落雪开发者密钥」的 `developerKey`。
   */
  extraHeaders?: Record<string, string> | undefined;
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
  private readonly extraHeaders: Record<string, string>;

  constructor(options: LxnsClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? LXNS_API_BASE).replace(/\/+$/, '');
    this.developerKey = options.developerKey?.trim() || undefined;
    this.userToken = options.userToken?.trim() || undefined;
    this.fetchImpl = options.fetchImpl ?? defaultFetch();
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.extraHeaders = options.extraHeaders ?? {};
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
    for (const [key, value] of Object.entries(this.extraHeaders)) {
      headers[key.toLowerCase()] = value;
    }

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

  // ── 中二节奏 ──────────────────────────────────────────────────────────
  //
  // 和舞萌走同一个服务、同一把密钥，只是路径前缀不同，
  // 所以全部复用上面的 `request()`——没有任何新的网络逻辑。

  /** 玩家信息。 */
  getChunithmPlayer(friendCode: number | string): Promise<ChunithmPlayer> {
    return this.request<ChunithmPlayer>(chunithmEndpoints.player(friendCode));
  }

  /** 按 QQ 号取玩家信息。 */
  getChunithmPlayerByQq(qq: number | string): Promise<ChunithmPlayer> {
    return this.request<ChunithmPlayer>(chunithmEndpoints.playerByQq(qq));
  }

  /**
   * Best 30 + Selection 10 + Recent 10。
   *
   * ⚠️ 舞萌那边是 `bests` 返回 B35+B15，中二是一次给三组。
   * 字段形状一样，但**语义不同**，别直接套用舞萌的组装逻辑。
   */
  getChunithmBests(friendCode: number | string): Promise<ChunithmBests> {
    return this.request<ChunithmBests>(chunithmEndpoints.bests(friendCode));
  }

  /** Recent 10，按 play_time 排序。 */
  getChunithmRecents(friendCode: number | string): Promise<ChunithmScore[]> {
    return this.request<ChunithmScore[]>(chunithmEndpoints.recents(friendCode));
  }

  /** 单曲最佳成绩。 */
  getChunithmBest(friendCode: number | string, query: ChunithmBestQuery): Promise<ChunithmScore> {
    return this.request<ChunithmScore>(chunithmEndpoints.best(friendCode, query));
  }

  /** 单曲全部难度成绩。 */
  getChunithmSongScores(
    friendCode: number | string,
    query: { song_id?: number; song_name?: string },
  ): Promise<ChunithmScore[]> {
    return this.request<ChunithmScore[]>(chunithmEndpoints.songScores(friendCode, query));
  }

  /** 曲目列表（公共接口，无需鉴权）。 */
  getChunithmSongList(query: { notes?: boolean } = {}): Promise<ChunithmSongList> {
    return this.request<ChunithmSongList>(chunithmEndpoints.songList(query));
  }

  /** 曲目别名列表（公共接口）。 */
  getChunithmAliasList(): Promise<ChunithmAliasList> {
    return this.request<ChunithmAliasList>(chunithmEndpoints.aliasList());
  }
}

function isAbortError(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  const name = (error as { name?: unknown }).name;
  return name === 'AbortError' || name === 'TimeoutError';
}
