/**
 * 落雪查分器数据源。
 *
 * 这是目前唯一的源，负责把落雪的接口形态适配成 `DataSource`。
 * 以后接别的查分站时，照抄这个文件的结构实现同一个接口即可，
 * **客户端不需要任何改动**。
 */

import { LxnsClient, type MaimaiAliasList, type MaimaiBests, type MaimaiPlayer } from '@astramai/core';

import type { DataSource, PlayerQuery, RawLibrary, SourceDescriptor } from './types.js';
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
  readonly games = ['maimai'] as const;

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

  async getBests(friendCode: number): Promise<MaimaiBests> {
    // 玩家信息通常已经取过，这里只再花一次；扣减按整段查询算的常量来
    this.options.limiter.spend(COST_PER_B50 - 1, this.label);
    return this.client().getBests(friendCode);
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
}

export { COST_PER_B50 };
