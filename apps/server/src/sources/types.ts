/**
 * 数据源抽象。
 *
 * 这是「服务端作为网关」的地基：客户端只认我们自己的协议，
 * 背后接的是落雪、还是以后别的查分站，由这一层决定。
 *
 * 设计约束：
 *   1. **源之间不共享字段结构**。返回值一律用 `@astramai/core` 里已经归一化
 *      好的领域模型（`MaimaiPlayer` / `MaimaiBests` / `MaimaiSongList`），
 *      上游怎么写与我们无关，换源不需要改客户端。
 *   2. **源不负责缓存**。缓存是服务端的关注点（各源 TTL 可能不同、
 *      还要并发合并），源只管「取一次」。
 *   3. **可用性要能自述**。没配置密钥的源应当出现在列表里但标记为不可用，
 *      而不是让客户端拿到一个莫名其妙的错误。
 */

import type {
  ChunithmAliasList,
  ChunithmBests,
  ChunithmPlayer,
  ChunithmSongList,
  MaimaiAliasList,
  MaimaiBests,
  MaimaiPlayer,
  MaimaiSongList,
} from '@astramai/core';

/** 定位一个玩家。好友码与 QQ 号二选一。 */
export interface PlayerQuery {
  friendCode?: number | undefined;
  qq?: number | undefined;
}

/** 曲库原始数据。缓存由服务端负责。 */
export interface RawLibrary {
  songs: MaimaiSongList;
  aliases: MaimaiAliasList;
}

/** 中二节奏曲库原始数据。 */
export interface RawChunithmLibrary {
  songs: ChunithmSongList;
  aliases: ChunithmAliasList;
}

/** 一个数据源对外的自述，用于 `/api/v1/sources` 和运行时的选择。 */
export interface SourceDescriptor {
  id: string;
  label: string;
  /** 支持的玩法，目前只有 maimai；将来中二 / 太鼓各算一个。 */
  games: readonly string[];
  /** 是否需要开发者密钥才能工作。 */
  requiresKey: boolean;
  /** 当前是否真的可用（比如密钥有没有配）。 */
  available: boolean;
  /** 不可用的原因，给使用者看的。 */
  unavailableReason?: string;
}

export interface DataSource {
  readonly id: string;
  readonly label: string;
  readonly games: readonly string[];

  /** 当前是否可用 + 原因。 */
  describe(): SourceDescriptor;

  /** 该源能否处理这个查询（比如有的源只支持好友码、不支持 QQ）。 */
  supports(query: PlayerQuery): boolean;

  getPlayer(query: PlayerQuery): Promise<MaimaiPlayer>;
  getBests(friendCode: number): Promise<MaimaiBests>;

  /** 取一次曲库。不要在这里做缓存。 */
  fetchLibrary(): Promise<RawLibrary>;

  /**
   * 取一次中二节奏曲库。
   *
   * 做成**可选方法**而不是接口必填项：目前只有落雪支持中二
   * （实测确认落雪只覆盖舞萌与中二两个游戏），
   * 强迫将来的每个源都实现一个它用不上的方法没有意义。
   * 调用方用 `source.games.includes('chunithm')` 或方法存在性判断。
   */
  fetchChunithmLibrary?(): Promise<RawChunithmLibrary>;

  /** 中二节奏玩家信息。只有支持中二的源才实现。 */
  getChunithmPlayer?(query: PlayerQuery): Promise<ChunithmPlayer>;

  /** 中二节奏成绩（B30 + Selection10 + Recent10）。 */
  getChunithmBests?(friendCode: number): Promise<ChunithmBests>;
}

/** 判断一个查询是否可用该源处理，并在不可用时给出人能看懂的原因。 */
export function explainUnsupported(source: DataSource, query: PlayerQuery): string {
  if (query.qq !== undefined && !source.supports(query)) {
    return `${source.label} 不支持用 QQ 号查询，请改用好友码。`;
  }
  return `${source.label} 无法处理这个查询。`;
}
