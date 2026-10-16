/**
 * 网关服务：把「客户端想要什么」翻译成「去哪个源取、怎么组装」。
 *
 * 客户端只认这一层暴露的协议，完全不需要知道背后是落雪还是别的东西。
 * 曲库缓存也在这里——缓存是服务端的关注点，源只管取一次。
 */

import {
  LxnsError,
  buildB50View,
  buildChunithmBestsView,
  buildSongIndex,
  createMockBests,
  createMockPlayer,
  createSyntheticSongList,
  type B50View,
  type ChunithmAliasList,
  type ChunithmBestsView,
  type ChunithmSongList,
  type MaimaiAliasList,
  type MaimaiPlayer,
  type MaimaiSongList,
  type SongIndex,
} from '@astramai/core';

import { resolveMode, type LxnsMode, type ServerConfig } from './config.js';
import { SourceRegistry } from './sources/registry.js';
import type { DataSource, PlayerQuery } from './sources/types.js';

export interface SongLibrary {
  songs: MaimaiSongList;
  aliases: MaimaiAliasList;
  index: SongIndex;
  fetchedAt: number;
  source: 'lxns' | 'synthetic';
}

/**
 * 中二节奏曲库缓存。
 *
 * 和舞萌那份分开存：两个游戏的字段结构不同（物量是 air/flick、
 * 难度有 6 档），共用一个缓存只会让两边都变复杂。
 */
export interface ChunithmLibrary {
  songs: ChunithmSongList;
  aliases: ChunithmAliasList;
  fetchedAt: number;
  source: 'lxns';
}

export interface B50Result {
  mode: LxnsMode;
  view: B50View;
  librarySource: SongLibrary['source'];
  sourceId: string;
  usedServerKey: boolean;
}

export class GatewayService {
  private readonly libraryBySource = new Map<string, SongLibrary>();
  private readonly inflight = new Map<string, Promise<SongLibrary>>();
  /** 中二曲库独立缓存，理由见 ChunithmLibrary 的注释。 */
  private readonly chunithmBySource = new Map<string, ChunithmLibrary>();
  private readonly chunithmInflight = new Map<string, Promise<ChunithmLibrary>>();

  constructor(
    private readonly config: ServerConfig,
    readonly registry: SourceRegistry,
  ) {}

  /** 解析本次请求实际使用的密钥。客户端临时密钥优先（仅本地测试开启）。 */
  private resolveKey(clientKey: string | undefined): { key: string | undefined; usedServerKey: boolean } {
    const trimmed = clientKey?.trim();
    if (trimmed) return { key: trimmed, usedServerKey: false };
    return { key: this.config.apiKey, usedServerKey: this.config.apiKey !== undefined };
  }

  /** 当前是否处于 Mock 模式。 */
  private modeFor(clientKey: string | undefined, forceMock: boolean | undefined): LxnsMode {
    if (forceMock) return 'mock';
    return resolveMode(this.config, this.resolveKey(clientKey).key !== undefined);
  }

  /**
   * 取某个源的曲库，带 TTL 缓存与并发合并。
   *
   * 缓存按源分开：换源时不该拿到上一个源的曲库。
   */
  async getLibrary(sourceId: string, clientKey?: string | undefined, force = false): Promise<SongLibrary> {
    const now = Date.now();
    const cached = this.libraryBySource.get(sourceId);
    if (!force && cached && now - cached.fetchedAt < this.config.songCacheTtlMs) return cached;

    const running = this.inflight.get(sourceId);
    if (running) return running;

    const task = (async (): Promise<SongLibrary> => {
      try {
        const source = this.registry.get(sourceId);
        const raw = await source.fetchLibrary();
        const library: SongLibrary = {
          songs: raw.songs,
          aliases: raw.aliases,
          index: buildSongIndex(raw.songs, raw.aliases),
          fetchedAt: Date.now(),
          source: 'lxns',
        };
        this.libraryBySource.set(sourceId, library);
        return library;
      } catch (error) {
        // 已经有旧缓存就继续用，哪怕过期也比失败好
        const stale = this.libraryBySource.get(sourceId);
        if (stale) return stale;

        // 只有**上游不可用**才降级成内置合成曲库。
        //
        // 这里必须区分开：源名拼错、密钥无效、权限不足、上游配额用尽，
        // 都是「调用方或配置有问题」，降级成假数据会给出一个**看起来正常但要命**的结果
        // ——客户端拿到假曲库却不知道。这类错误必须原样抛出去。
        if (error instanceof LxnsError && !UPSTREAM_FAILURE_KINDS.has(error.kind)) throw error;

        console.warn('[AstraMai] 曲库拉取失败，回退到内置合成曲库：', describe(error));
        const songs = createSyntheticSongList();
        const aliases: MaimaiAliasList = { aliases: [] };
        const library: SongLibrary = {
          songs,
          aliases,
          index: buildSongIndex(songs, aliases),
          fetchedAt: Date.now(),
          source: 'synthetic',
        };
        this.libraryBySource.set(sourceId, library);
        return library;
      } finally {
        this.inflight.delete(sourceId);
      }
    })();

    this.inflight.set(sourceId, task);
    return task;
  }

  cacheStatus(): { cached: boolean; source: SongLibrary['source'] | null; ageMs: number | null; songCount: number } {
    const first = [...this.libraryBySource.values()][0];
    if (!first) return { cached: false, source: null, ageMs: null, songCount: 0 };
    return {
      cached: true,
      source: first.source,
      ageMs: Date.now() - first.fetchedAt,
      songCount: first.songs.songs.length,
    };
  }

  /**
   * 取中二节奏曲库，带 TTL 缓存与并发合并。
   *
   * ⚠️ **刻意不做合成数据兜底。**
   *
   * 舞萌那边有内置合成曲库可以退，是因为我们确实准备了一份。
   * 中二这边没有——凭空编一份假的中二曲库只会产生
   * 「看起来正常但全是假的」的结果，比直接报错危险得多。
   * 所以这里失败就抛出去，宁可让客户端看到错误。
   */
  async getChunithmLibrary(
    sourceId: string,
    clientKey?: string | undefined,
    force = false,
  ): Promise<ChunithmLibrary> {
    const now = Date.now();
    const cached = this.chunithmBySource.get(sourceId);
    if (!force && cached && now - cached.fetchedAt < this.config.songCacheTtlMs) return cached;

    const running = this.chunithmInflight.get(sourceId);
    if (running) return running;

    const task = (async (): Promise<ChunithmLibrary> => {
      try {
        const source = this.registry.get(sourceId);
        if (typeof source.fetchChunithmLibrary !== 'function') {
          throw new LxnsError('bad-request', `${source.label} 不支持中二节奏`);
        }
        const raw = await source.fetchChunithmLibrary();
        const library: ChunithmLibrary = {
          songs: raw.songs,
          aliases: raw.aliases,
          fetchedAt: Date.now(),
          source: 'lxns',
        };
        this.chunithmBySource.set(sourceId, library);
        return library;
      } catch (error) {
        // 过期缓存也比失败好——这一点和舞萌那边一致
        const stale = this.chunithmBySource.get(sourceId);
        if (stale) {
          console.warn('[AstraMai] 中二曲库拉取失败，沿用旧缓存：', describe(error));
          return stale;
        }
        throw error;
      } finally {
        this.chunithmInflight.delete(sourceId);
      }
    })();

    this.chunithmInflight.set(sourceId, task);
    return task;
  }

  /** 主流程：取玩家 + Best 50，组装成可直接渲染的视图模型。 */
  async getB50(input: {
    friendCode?: number | undefined;
    qq?: number | undefined;
    /** 自建 net 的用户名。 */
    username?: string | undefined;
    sourceId?: string | undefined;
    clientKey?: string | undefined;
    forceMock?: boolean | undefined;
  }): Promise<B50Result> {
    const source = this.registry.get(input.sourceId);
    const { key, usedServerKey } = this.resolveKey(input.clientKey);
    const mode = this.modeFor(input.clientKey, input.forceMock);

    const query: PlayerQuery = {
      friendCode: input.friendCode,
      qq: input.qq,
      username: input.username,
    };
    if (mode !== 'mock' && !source.supports(query)) {
      throw new LxnsError('bad-request', `${source.label} 不支持这个查询方式`, {
        friendly: explainUnsupportedBy(source, query),
      });
    }

    const library = await this.getLibrary(source.id, input.clientKey);
    void key;

    if (mode === 'mock') {
      const seed = seedFrom(input.qq ?? input.friendCode ?? 20240101);
      const friendCode = input.friendCode ?? (input.qq ? qqToPseudoFriendCode(input.qq) : 888888888888888);
      const bests = createMockBests(library.songs, { seed, targetRating: 15_000 });
      const rating = bests.standard_total + bests.dx_total;
      const player = createMockPlayer({ seed, friendCode, name: 'Ｍｏｃｋ　Ｐｌａｙｅｒ', rating });
      const view = buildB50View({ player, bests, index: library.index, friendCode });
      return { mode, view, librarySource: library.source, sourceId: source.id, usedServerKey };
    }

    const player: MaimaiPlayer = await source.getPlayer(query);
    // 传 query 而不是 player.friend_code——自建 net 没有好友码，
    // 它要的是用户名。源自己知道该用哪个字段。
    const bests = await source.getBests(query);
    const view = buildB50View({
      player,
      bests,
      index: library.index,
      friendCode: input.friendCode ?? player.friend_code,
    });
    return { mode, view, librarySource: library.source, sourceId: source.id, usedServerKey };
  }

  /**
   * 中二节奏成绩视图。
   *
   * 和舞萌那条路几乎一样，但**不做 Mock**：我们确实准备了一份舞萌的模拟数据，
   * 中二没有。凭空编一份假的只会产生「看起来正常但全是假的」的结果。
   */
  async getChunithmBests(input: {
    friendCode?: number | undefined;
    qq?: number | undefined;
    /** 自建 net 的用户名。 */
    username?: string | undefined;
    sourceId?: string | undefined;
    clientKey?: string | undefined;
    forceMock?: boolean | undefined;
  }): Promise<{
    mode: LxnsMode;
    view: ChunithmBestsView;
    sourceId: string;
    usedServerKey: boolean;
  }> {
    const source = this.registry.get(input.sourceId);
    const { usedServerKey } = this.resolveKey(input.clientKey);
    const mode = this.modeFor(input.clientKey, input.forceMock);

    if (this.modeFor(input.clientKey, false) === 'mock' && input.forceMock) {
      throw new LxnsError('bad-request', '中二节奏暂不提供模拟数据', {
        friendly: '中二节奏还没有内置模拟数据，请用真实好友码查询。',
      });
    }

    if (typeof source.getChunithmPlayer !== 'function' || typeof source.getChunithmBests !== 'function') {
      throw new LxnsError('bad-request', `${source.label} 不支持中二节奏成绩查询`);
    }

    const library = await this.getChunithmLibrary(source.id, input.clientKey);
    const query: PlayerQuery = {
      friendCode: input.friendCode,
      qq: input.qq,
      username: input.username,
    };
    if (!source.supports(query)) {
      throw new LxnsError('bad-request', `${source.label} 不支持这个查询方式`, {
        friendly: explainUnsupportedBy(source, query),
      });
    }

    const player = await source.getChunithmPlayer(query);
    const bests = await source.getChunithmBests(query);
    const view = buildChunithmBestsView({ player, bests, songs: library.songs });

    return { mode, view, sourceId: source.id, usedServerKey };
  }

  /** 玩家信息，不做 B50 聚合。 */
  async getPlayer(input: {
    friendCode?: number | undefined;
    qq?: number | undefined;
    /** 自建 net 的用户名。 */
    username?: string | undefined;
    sourceId?: string | undefined;
    clientKey?: string | undefined;
  }): Promise<{ mode: LxnsMode; player: MaimaiPlayer; sourceId: string }> {
    const source = this.registry.get(input.sourceId);
    const mode = this.modeFor(input.clientKey, false);
    if (mode === 'mock') {
      throw new LxnsError('bad-request', 'Mock 模式下不提供玩家信息', {
        friendly: '演示数据不提供单独的玩家信息，请用 B50 接口（它会带上完整模拟数据）。',
      });
    }
    const player = await source.getPlayer({
      friendCode: input.friendCode,
      qq: input.qq,
      username: input.username,
    });
    return { mode, player, sourceId: source.id };
  }

  /** 单曲成绩。 */
  async getSongScores(input: {
    friendCode: number;
    songId: number;
    songType?: 'standard' | 'dx' | 'utage' | undefined;
    sourceId?: string | undefined;
    clientKey?: string | undefined;
  }): Promise<{ mode: LxnsMode; scores: unknown[] }> {
    const mode = this.modeFor(input.clientKey, false);
    if (mode === 'mock') return { mode, scores: [] };
    // 目前只有落雪提供单曲成绩；接入别的源时在这里按 source.id 分派
    this.registry.get(input.sourceId);
    const { LxnsClient } = await import('@astramai/core');
    const client = new LxnsClient({ developerKey: this.resolveKey(input.clientKey).key });
    const scores = await client.getSongScores(input.friendCode, {
      song_id: input.songId,
      ...(input.songType ? { song_type: input.songType } : {}),
    });
    return { mode, scores };
  }
}

function explainUnsupportedBy(source: DataSource, query: PlayerQuery): string {
  if (query.qq !== undefined) return `${source.label} 不支持用 QQ 号查询，请改用好友码。`;
  if (query.username !== undefined) {
    return `${source.label} 不支持用用户名查询，请改用好友码。`;
  }
  return `${source.label} 无法处理这个查询。`;
}

/**
 * 哪些错误算是「上游不可用」，可以降级成合成曲库。
 *
 * 其余的错误（源名拼错、密钥无效、权限不足、配额用尽）都是调用方或配置的问题，
 * 必须原样抛出去——降级会让调用方拿到一份看起来正常的假数据。
 */
const UPSTREAM_FAILURE_KINDS = new Set(['network', 'timeout', 'server', 'malformed']);

/** 由好友码/QQ 派生稳定种子——同一输入必须得到同一份模拟数据。 */
export function seedFrom(value: number): number {
  let hash = 2166136261;
  for (const char of String(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function qqToPseudoFriendCode(qq: number): number {
  return 100000000000000 + (seedFrom(qq) % 800000000000000);
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
