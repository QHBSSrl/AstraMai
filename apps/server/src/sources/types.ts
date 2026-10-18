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
  OsuBests,
  OsuPlayer,
} from '@astramai/core';

/**
 * 定位一个玩家。三种标识各有各的适用源，具体支持哪种由源自己声明。
 *
 *   friendCode —— 落雪（国服），15 位好友码
 *   qq         —— 落雪，部分国服玩家的 QQ 号
 *   username   —— **自建 net**（AquaDX/AquaNet），用户名
 *
 * 之所以要三种而不是统一成一种：**上游就是不一样**。
 * 硬要归一就得让某个源去维护一张映射表，那是把上游的差异搬到我们这边来，
 * 换源时反而更麻烦。让源用 `supports()` 自述，调用方负责选。
 */
export interface PlayerQuery {
  friendCode?: number | undefined;
  qq?: number | undefined;
  /** 自建 net 的用户名。 */
  username?: string | undefined;
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

  /**
   * 上游自己的**硬性**限流上限（每分钟）。
   *
   * 和全局 `UPSTREAM_LIMIT_PER_MINUTE` 取小：全局预算是我们自己的成本控制，
   * 而这个值是上游 ToS 明写的红线（比如 osu! 是 60），两个都得守。
   *
   * 不填表示「没有额外上限」，只用全局预算。
   */
  readonly hardLimitPerMinute?: number;

  /** 当前是否可用 + 原因。 */
  describe(): SourceDescriptor;

  /** 该源能否处理这个查询（比如有的源只支持好友码、不支持 QQ）。 */
  supports(query: PlayerQuery): boolean;

  getPlayer(query: PlayerQuery): Promise<MaimaiPlayer>;

  /**
   * 取 Best 50。
   *
   * 收 `PlayerQuery` 而不是好友码——原来那个签名是**落雪的形状**
   * （先 `getPlayer` 拿到 `friend_code`，再拿它来查）。
   * 自建 net 用用户名、没有好友码，硬套会变成「把用户名塞进 number 参数」。
   * 改成收 query 之后两种源都能自然表达。
   */
  getBests(query: PlayerQuery): Promise<MaimaiBests>;

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
  getChunithmBests?(query: PlayerQuery): Promise<ChunithmBests>;

  /**
   * osu! 玩家信息。
   *
   * 为什么要单独一对方法，不复用 `getPlayer` / `getBests`：
   * 那两个是**舞萌的形状**（`MaimaiBests` 里有 `standard_total` / `dx_total`），
   * osu! 的评级是 pp、成绩是 play 列表，硬套只会让调用方拿到一堆假字段。
   *
   * 和中二那套 `getChunithmPlayer` / `getChunithmBests` 是同一个模式。
   */
  getOsuPlayer?(query: PlayerQuery): Promise<OsuPlayer>;

  /** osu! 最好成绩（按 pp 降序）。 */
  getOsuBests?(query: PlayerQuery): Promise<OsuBests>;
}

/** 判断一个查询是否可用该源处理，并在不可用时给出人能看懂的原因。 */
export function explainUnsupported(source: DataSource, query: PlayerQuery): string {
  if (query.qq !== undefined && !source.supports(query)) {
    return `${source.label} 不支持用 QQ 号查询，请改用好友码。`;
  }
  if (query.username !== undefined && !source.supports(query)) {
    return `${source.label} 不支持用用户名查询，请改用好友码。`;
  }
  return `${source.label} 无法处理这个查询。`;
}
