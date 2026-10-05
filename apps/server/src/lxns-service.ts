/**
 * 落雪数据服务：曲库缓存 + B50 聚合 + Mock 降级。
 *
 * 这一层是「服务端唯一知道密钥的地方」。浏览器拿到的永远是聚合后的结果，
 * 不含密钥，也不含落雪的原始响应结构。
 */

import {
  LxnsClient,
  LxnsError,
  buildB50View,
  buildSongIndex,
  createMockBests,
  createMockPlayer,
  createSyntheticSongList,
  type B50View,
  type MaimaiAliasList,
  type MaimaiPlayer,
  type MaimaiSongList,
  type SongIndex,
} from '@astramai/core';

import { resolveMode, type LxnsMode, type ServerConfig } from './config.js';

export interface SongLibrary {
  songs: MaimaiSongList;
  aliases: MaimaiAliasList;
  index: SongIndex;
  fetchedAt: number;
  /** 曲库来源：真实公共接口，还是内置合成数据。 */
  source: 'lxns' | 'synthetic';
}

export interface B50Result {
  mode: LxnsMode;
  view: B50View;
  librarySource: SongLibrary['source'];
  /** 服务端是否使用了自带密钥（false 表示用了浏览器临时递交的密钥）。 */
  usedServerKey: boolean;
}

export class LxnsService {
  private library: SongLibrary | null = null;
  private libraryInflight: Promise<SongLibrary> | null = null;
  /** 全局上游预算的固定窗口。 */
  private upstream = { count: 0, resetAt: 0 };

  constructor(private readonly config: ServerConfig) {}

  /**
   * 扣减全局上游预算，额度不足时抛错。
   *
   * 为什么需要它：令牌会随客户端分发出去（写进手表 App 的包里，谁都能解出来），
   * 所以不能靠令牌来限制用量。一旦有人写脚本刷，烧的是我们自己的开发者密钥配额，
   * 落雪会直接返回 429。这一层与「有多少客户端」无关，只统计真正打到落雪的请求，
   * 因此命中缓存的请求不消耗预算。
   */
  private spendUpstream(count: number): void {
    const limit = this.config.upstreamLimitPerMinute;
    if (limit <= 0) return;

    const now = Date.now();
    if (now >= this.upstream.resetAt) {
      this.upstream = { count: 0, resetAt: now + 60_000 };
    }
    if (this.upstream.count + count > limit) {
      throw new LxnsError('rate-limited', `上游调用已达每分钟 ${limit} 次上限`, {
        friendly: '当前使用人数较多，服务器对落雪的调用已达每分钟上限，请过一会儿再试。',
      });
    }
    this.upstream.count += count;
  }

  /** 供 /api/health 展示上游预算余量。 */
  upstreamStatus(): { limitPerMinute: number; usedThisMinute: number; remaining: number } {
    const limit = this.config.upstreamLimitPerMinute;
    const now = Date.now();
    const used = now >= this.upstream.resetAt ? 0 : this.upstream.count;
    return {
      limitPerMinute: limit,
      usedThisMinute: used,
      remaining: limit <= 0 ? Number.POSITIVE_INFINITY : Math.max(0, limit - used),
    };
  }

  /** 解析本次请求实际使用的密钥。浏览器临时密钥优先于服务端密钥。 */
  private resolveKeys(clientKey: string | undefined): { developerKey: string | undefined; usedServerKey: boolean } {
    const trimmed = clientKey?.trim();
    if (trimmed) return { developerKey: trimmed, usedServerKey: false };
    return { developerKey: this.config.apiKey, usedServerKey: this.config.apiKey !== undefined };
  }

  private clientFor(clientKey: string | undefined): LxnsClient {
    const { developerKey } = this.resolveKeys(clientKey);
    return new LxnsClient({ developerKey });
  }

  /**
   * 取曲库（带 TTL 缓存与并发合并）。
   *
   * 曲库走落雪公共接口，不需要鉴权——这也是 Mock 模式能拿到真实曲目的原因。
   */
  async getLibrary(clientKey?: string | undefined, force = false): Promise<SongLibrary> {
    const now = Date.now();
    if (!force && this.library && now - this.library.fetchedAt < this.config.songCacheTtlMs) {
      return this.library;
    }
    if (this.libraryInflight) return this.libraryInflight;

    const task = (async (): Promise<SongLibrary> => {
      const client = this.clientFor(clientKey);
      try {
        // 曲库只在缓存过期时才真的打上游：歌单 + 别名两次
        this.spendUpstream(2);
        const [songs, aliases] = await Promise.all([
          client.getSongList({ notes: true }),
          client.getAliasList().catch(() => ({ aliases: [] }) as MaimaiAliasList),
        ]);
        const library: SongLibrary = {
          songs,
          aliases,
          index: buildSongIndex(songs, aliases),
          fetchedAt: Date.now(),
          source: 'lxns',
        };
        this.library = library;
        return library;
      } catch (error) {
        // 已经有旧缓存就继续用，哪怕过期也比失败好
        if (this.library) return this.library;
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
        this.library = library;
        return library;
      } finally {
        this.libraryInflight = null;
      }
    })();

    this.libraryInflight = task;
    return task;
  }

  /** 供 /api/health 使用。 */
  cacheStatus(): { cached: boolean; source: SongLibrary['source'] | null; ageMs: number | null; songCount: number } {
    if (!this.library) return { cached: false, source: null, ageMs: null, songCount: 0 };
    return {
      cached: true,
      source: this.library.source,
      ageMs: Date.now() - this.library.fetchedAt,
      songCount: this.library.songs.songs.length,
    };
  }

  /**
   * 主流程：取玩家 + Best 50，组装成一份可直接渲染的视图模型。
   *
   * `friendCode` 与 `qq` 二选一。
   */
  async getB50(input: {
    friendCode?: number | undefined;
    qq?: number | undefined;
    clientKey?: string | undefined;
    /** 强制使用模拟数据（页面的「看演示数据」按钮）。 */
    forceMock?: boolean | undefined;
  }): Promise<B50Result> {
    const { developerKey, usedServerKey } = this.resolveKeys(input.clientKey);
    const mode = input.forceMock ? 'mock' : resolveMode(this.config, developerKey !== undefined);
    const library = await this.getLibrary(input.clientKey);

    if (mode === 'mock') {
      const seed = seedFrom(input.qq ?? input.friendCode ?? 20240101);
      const friendCode = input.friendCode ?? (input.qq ? qqToPseudoFriendCode(input.qq) : 888888888888888);
      const bests = createMockBests(library.songs, { seed, targetRating: 15_000 });
      // 让玩家总 Rating 与 B35+B15 严格自洽，避免演示数据自相矛盾
      const rating = bests.standard_total + bests.dx_total;
      const player = createMockPlayer({ seed, friendCode, name: 'Ｍｏｃｋ　Ｐｌａｙｅｒ', rating });
      const view = buildB50View({ player, bests, index: library.index, friendCode });
      return { mode, view, librarySource: library.source, usedServerKey };
    }

    const client = new LxnsClient({ developerKey });
    // 一次 B50 要打两次上游：取玩家、取 Best 50。都无法缓存（每个玩家不同）
    this.spendUpstream(2);
    const player: MaimaiPlayer = input.qq
      ? await client.getPlayerByQq(input.qq)
      : await client.getPlayer(input.friendCode as number);
    const bests = await client.getBests(player.friend_code);

    const view = buildB50View({
      player,
      bests,
      index: library.index,
      friendCode: input.friendCode ?? player.friend_code,
    });
    return { mode, view, librarySource: library.source, usedServerKey };
  }

  /** 单曲成绩（某好友码下某首歌的全部难度）。 */
  async getSongScores(input: {
    friendCode: number;
    songId: number;
    songType?: 'standard' | 'dx' | 'utage' | undefined;
    clientKey?: string | undefined;
  }): Promise<{ mode: LxnsMode; scores: unknown[] }> {
    const { developerKey } = this.resolveKeys(input.clientKey);
    const mode = resolveMode(this.config, developerKey !== undefined);
    if (mode === 'mock') return { mode, scores: [] };

    const client = new LxnsClient({ developerKey });
    this.spendUpstream(1);
    const scores = await client.getSongScores(input.friendCode, {
      song_id: input.songId,
      ...(input.songType ? { song_type: input.songType } : {}),
    });
    return { mode, scores };
  }
}

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
