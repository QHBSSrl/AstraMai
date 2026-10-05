/**
 * 落雪 API 端点拼装。
 *
 * 基础 URL 固定为 https://maimai.lxns.net/api/v0/
 * 见 https://maimai.lxns.net/docs/developer-guide#鉴权方式
 */

/** 落雪 API 基础 URL。 */
export const LXNS_API_BASE = 'https://maimai.lxns.net/api/v0';

export interface SongListQuery {
  /** 游戏版本，默认 25500（落雪侧默认值）。 */
  version?: number | undefined;
  /** 是否包含谱面物量。 */
  notes?: boolean | undefined;
}

function withQuery(path: string, params: Record<string, string | number | boolean | undefined>): string {
  // 刻意不用 `URLSearchParams`：它不是 ECMAScript 的一部分，Vela 的 JS 引擎不一定提供。
  // 这里只依赖标准的 `encodeURIComponent` 与 `Object.entries`。
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  return parts.length > 0 ? `${path}?${parts.join('&')}` : path;
}

/** 舞萌 DX 接口路径。 */
export const maimaiEndpoints = {
  player: (friendCode: number | string) => `/maimai/player/${friendCode}`,
  playerByQq: (qq: number | string) => `/maimai/player/qq/${qq}`,
  /** 玩家信息（当前密钥对应的玩家，个人 API）。 */
  selfPlayer: () => '/user/maimai/player',
  /** Best 50。 */
  bests: (friendCode: number | string) => `/maimai/player/${friendCode}/bests`,
  /** All Perfect 50。 */
  bestsAp: (friendCode: number | string) => `/maimai/player/${friendCode}/bests/ap`,
  /** 单曲最佳成绩。 */
  best: (
    friendCode: number | string,
    query: { song_id?: number; song_name?: string; level_index?: number; song_type?: string },
  ) => withQuery(`/maimai/player/${friendCode}/best`, query),
  /** 单曲全部难度成绩。 */
  songScores: (
    friendCode: number | string,
    query: { song_id?: number; song_name?: string; song_type?: string },
  ) => withQuery(`/maimai/player/${friendCode}/bests`, query),
  /** Recent 50。 */
  recents: (friendCode: number | string) => `/maimai/player/${friendCode}/recents`,
  /** 全部最佳成绩（简化）。 */
  scores: (friendCode: number | string) => `/maimai/player/${friendCode}/scores`,
  /** 上传热力图。 */
  heatmap: (friendCode: number | string) => `/maimai/player/${friendCode}/heatmap`,
  /** DX Rating 趋势。 */
  trend: (friendCode: number | string, version?: number) =>
    withQuery(`/maimai/player/${friendCode}/trend`, { version }),
  /** 成绩上传历史。 */
  scoreHistory: (
    friendCode: number | string,
    query: { song_id?: number; song_type?: string; level_index?: number },
  ) => withQuery(`/maimai/player/${friendCode}/score/history`, query),
  /** 曲目列表（公共接口，无需鉴权）。 */
  songList: (query: SongListQuery = {}) =>
    withQuery('/maimai/song/list', { version: query.version, notes: query.notes }),
  /** 单曲信息（公共接口）。 */
  song: (songId: number | string, version?: number) => withQuery(`/maimai/song/${songId}`, { version }),
  /** 曲目别名列表（公共接口）。 */
  aliasList: () => '/maimai/alias/list',
  /** 收藏品列表（公共接口）。 */
  collectionList: (type: 'trophy' | 'icon' | 'plate' | 'frame', query: { version?: number; required?: boolean } = {}) =>
    withQuery(`/maimai/${type}/list`, { version: query.version, required: query.required }),
  /** 玩家收藏品进度。 */
  playerCollection: (friendCode: number | string, type: string, id: number | string) =>
    `/maimai/player/${friendCode}/${type}/${id}`,
} as const;
