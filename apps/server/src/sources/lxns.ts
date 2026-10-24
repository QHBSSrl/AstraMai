/**
 * 落雪查分器数据源。
 *
 * 这是目前唯一的源，负责把落雪的接口形态适配成 `DataSource`。
 * 以后接别的查分站时，照抄这个文件的结构实现同一个接口即可，
 * **客户端不需要任何改动**。
 */

import {
  LxnsClient,
  type ChunithmAliasList,
  type ChunithmBests,
  type ChunithmPlayer,
  type MaimaiAliasList,
  type MaimaiBests,
  type MaimaiPlayer,
} from '@astramai/core';

import type {
  DataSource,
  PlayerQuery,
  RawChunithmLibrary,
  RawLibrary,
  SourceDescriptor,
} from './types.js';
import type { UpstreamLimiter } from './upstream-limiter.js';

/** 一次 B50 要打两次上游：取玩家、取 Best 50。都无法缓存（每个玩家不同）。 */
const COST_PER_B50 = 2;
/** 曲库是歌单 + 别名两次，但会被长时间缓存。 */
const COST_PER_LIBRARY = 2;

export interface LxnsSourceOptions {
  /**
   * 取本次请求实际使用的密钥。
   *
   * 做成函数而不是值，是为了保留「客户端临时递交密钥」的能力
   * （`ALLOW_CLIENT_KEY`，仅本地测试用）——公开部署时它是关掉的。
   */
  resolveKey: () => string | undefined;
  limiter: UpstreamLimiter;
}

export class LxnsSource implements DataSource {
  readonly id = 'lxns';
  readonly label = '落雪查分器';
  /**
   * 落雪同时覆盖舞萌与中二节奏，**用的是同一把密钥、同一套路径前缀规则**。
   * 这也是「接中二 ≈ 加一个 Source」的依据。
   */
  readonly games = ['maimai', 'chunithm'] as const;

  constructor(private readonly options: LxnsSourceOptions) {}

  describe(): SourceDescriptor {
    const key = this.options.resolveKey();
    return {
      id: this.id,
      label: this.label,
      games: this.games,
      requiresKey: true,
      available: key !== undefined,
      ...(key === undefined ? { unavailableReason: '服务端未配置落雪开发者密钥' } : {}),
    };
  }

  supports(query: PlayerQuery): boolean {
    // 落雪只认好友码和 QQ 号，不认用户名（那是自建 net 的标识）
    return query.friendCode !== undefined || query.qq !== undefined;
  }

  private client(): LxnsClient {
    return new LxnsClient({ developerKey: this.options.resolveKey() });
  }

  async getPlayer(query: PlayerQuery): Promise<MaimaiPlayer> {
    this.options.limiter.spend(1, this.label);
    const client = this.client();
    return query.qq !== undefined
      ? client.getPlayerByQq(query.qq)
      : client.getPlayer(query.friendCode as number);
  }

  async getBests(query: PlayerQuery): Promise<MaimaiBests> {
    /*
     * ⚠️ **落雪没有 `/maimai/player/qq/{qq}/bests` 这个接口。**
     *
     * 实测：
     *   /maimai/player/qq/3687236844/bests  → 404
     *   /maimai/player/3687236844/bests     → 400（好友码位数不对）
     *
     * 也就是说 `bests` 只认好友码，只有 `player` 支持 QQ。
     *
     * 所以 QQ 查询必须**先查一次 player 拿到 friend_code**，再用好友码查
     * bests。多花一次上游调用，但这是落雪的接口限制，绕不过去。
     *
     * 这里踩过的坑：原来直接 `getBests(query.friendCode as number)`，
     * QQ 查询时 friendCode 是 undefined，拼出
     * `/maimai/player/undefined/bests`，报的是
     * 「好友码应为 15 位数字」—— 一个和 QQ 完全无关的错误信息，
     * 让人以为是客户端传错了参数。
     */
    this.options.limiter.spend(COST_PER_B50 - 1, this.label);
    const client = this.client();

    if (query.qq !== undefined) {
      const player = await client.getPlayerByQq(query.qq);
      if (!player.friend_code) {
        throw new Error('这个 QQ 号没有绑定落雪好友码，无法查询成绩');
      }
      return client.getBests(player.friend_code);
    }

    return client.getBests(query.friendCode as number);
  }

  async fetchLibrary(): Promise<RawLibrary> {
    this.options.limiter.spend(COST_PER_LIBRARY, this.label);
    const client = this.client();
    const [songs, aliases] = await Promise.all([
      client.getSongList({ notes: true }),
      client.getAliasList().catch(() => ({ aliases: [] }) as MaimaiAliasList),
    ]);
    return { songs, aliases };
  }

  /**
   * 中二节奏曲库。
   *
   * 和舞萌走同一个客户端、同一次限额预算——因为确实是同一个上游。
   * 别名接口失败时降级成空列表：曲库本身能用，不该因为别名挂掉就整个失败。
   */
  async fetchChunithmLibrary(): Promise<RawChunithmLibrary> {
    this.options.limiter.spend(COST_PER_LIBRARY, this.label);
    const client = this.client();
    const [songs, aliases] = await Promise.all([
      client.getChunithmSongList({ notes: true }),
      client.getChunithmAliasList().catch(() => ({ aliases: [] }) as ChunithmAliasList),
    ]);
    return { songs, aliases };
  }

  /** 中二玩家信息。和舞萌共用同一把密钥、同一个客户端。 */
  async getChunithmPlayer(query: PlayerQuery): Promise<ChunithmPlayer> {
    this.options.limiter.spend(1, this.label);
    const client = this.client();
    return query.qq !== undefined
      ? client.getChunithmPlayerByQq(query.qq)
      : client.getChunithmPlayer(query.friendCode as number);
  }

  /** 中二成绩。上游一次给 B30 + Selection10 + Recent10。 */
  async getChunithmBests(query: PlayerQuery): Promise<ChunithmBests> {
    this.options.limiter.spend(COST_PER_B50 - 1, this.label);
    return this.client().getChunithmBests(query.friendCode as number);
  }
}

export { COST_PER_B50 };
