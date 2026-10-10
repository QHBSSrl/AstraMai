/**
 * 落雪查分器 —— 中二节奏（CHUNITHM）API 数据类型。
 *
 * 依据：
 * - 文档：https://github.com/Lxns-Network/maimai-prober-frontend/wiki/中二节奏-API-列表
 * - **实测**：2026-10 直接请求 `/api/v0/chunithm/song/list?notes=true` 核对过字段
 *
 * ⚠️ 文档和实测有一处不一致，以实测为准：
 *   文档只列了 `LevelIndex` 0–4（BASIC/ADVANCED/EXPERT/MASTER/ULTIMA），
 *   但真实数据里出现了 **5**。中二节奏有 **WORLD'S END**。
 *   只看文档会把这一整档漏掉，UI 上会显示成 `#5`。
 *
 * 与舞萌的差异（这是"接中二 ≈ 加一个 Source"的依据）：
 *   物量字段：air / flick        （舞萌是 touch / break）
 *   难度档位：0–5 共六档          （舞萌是 0–4）
 *   成绩构成：B30 + Selection10 + Recent10（舞萌是 B35 + B15）
 *
 * 本文件只描述字段形状，不做校验。所有时间均为 UTC。
 */

/**
 * 中二节奏谱面难度下标。
 *
 * 0 BASIC / 1 ADVANCED / 2 EXPERT / 3 MASTER / 4 ULTIMA / 5 WORLD'S END
 *
 * ⚠️ 用 number 而不是字面量联合：上游随时可能加档位，
 * 写死成 `0|1|2|3|4|5` 一旦加档就会类型报错，而实际数据仍然能显示。
 * 越界的档位在 UI 层按「未知难度」兜底。
 */
export type ChunithmLevelIndex = number;

/** 中二节奏 CLEAR 类型。 */
export type ChunithmClearType = 'clear' | 'failed';

/** 中二节奏 FULL COMBO 类型。`alljustice` 里没区分 AJ 与 AJC，需要自行判断。 */
export type ChunithmFullComboType = 'alljustice' | 'fullcombo';

/** 中二节奏 FULL CHAIN 类型。`fullchain` 是铂，`fullchain2` 是金。 */
export type ChunithmFullChainType = 'fullchain' | 'fullchain2';

/** 中二节奏评级。 */
export type ChunithmRankType =
  | 'sssp'
  | 'sss'
  | 'ssp'
  | 'ss'
  | 'sp'
  | 's'
  | 'aaa'
  | 'aa'
  | 'a'
  | 'bbb'
  | 'bb'
  | 'b'
  | 'c'
  | 'd';

/** 收藏品（称号 / 名牌版 / 地图头像）。 */
export interface ChunithmCollection {
  id: number;
  name: string;
  /** 仅玩家称号有；值可空。 */
  color?: string | null;
}

/** 玩家信息。 */
export interface ChunithmPlayer {
  /** 游戏内名称。 */
  name: string;
  /**
   * 玩家等级。
   * ⚠️ 类型是 **string** 而不是 number——文档如此，实际也如此。
   */
  level: string;
  /** 玩家 Rating。是整数。 */
  rating: number;
  friend_code: number;
  /** 总 OVER POWER。 */
  over_power: number;
  /** 上局游戏中变更的 OVER POWER。 */
  change_over_power: number;
  icon_url: string;
  /** 当前金币数。注意是 string。 */
  currency: string;
  /** 总金币数。注意是 string。 */
  total_currency: string;
  /** 总游玩次数。注意是 string。 */
  total_play_count: string;
  trophy?: ChunithmCollection | null;
  name_plate?: ChunithmCollection | null;
  map_icon?: ChunithmCollection | null;
  /** 仅「获取玩家信息」返回，玩家被同步时的 UTC 时间。 */
  upload_time?: string | null;
}

/** 单条成绩。 */
export interface ChunithmScore {
  /** 曲目 ID。 */
  id: number;
  /** 仅获取成绩时返回。 */
  song_name?: string;
  /** 仅获取成绩时返回，难度标级，如 `14+`。 */
  level?: string;
  /** 难度下标。 */
  level_index: ChunithmLevelIndex;
  score: number;
  /** 仅获取成绩时返回。**是浮点数**（舞萌那边是整数）。 */
  rating?: number;
  clear: ChunithmClearType;
  full_combo?: ChunithmFullComboType | null;
  full_chain?: ChunithmFullChainType | null;
  /** 仅获取成绩时返回。 */
  rank?: ChunithmRankType;
  /** 游玩时间，值可空，精确到分钟。 */
  play_time?: string | null;
  /** 仅获取成绩时返回。 */
  upload_time?: string;
}

/** Best 30 / Selection 10 / Recent 10。 */
export interface ChunithmBests {
  bests: ChunithmScore[];
  selections: ChunithmScore[];
  recents: ChunithmScore[];
}

/** 谱面物量。 */
export interface ChunithmNotes {
  total: number;
  tap: number;
  hold: number;
  /** 中二特色：AIR。 */
  air: number;
  /** 中二特色：FLICK。 */
  flick: number;
  slide: number;
}

/** 谱面难度。 */
export interface ChunithmSongDifficulty {
  difficulty: ChunithmLevelIndex;
  /** 难度标级，如 `14+`。 */
  level: string;
  /** 谱面定数。 */
  level_value: number;
  note_designer: string;
  /** 谱面首次出现版本。 */
  version: number;
  notes?: ChunithmNotes | null;
}

/** 曲目。 */
export interface ChunithmSong {
  id: number;
  title: string;
  artist: string;
  genre: string;
  bpm: number;
  /** 曲目首次出现版本。 */
  version: number;
  difficulties: ChunithmSongDifficulty[];
}

/** 乐曲分类。 */
export interface ChunithmGenre {
  id: number;
  /** 分类标题（日文）。 */
  genre: string;
}

/** 曲目版本。 */
export interface ChunithmVersion {
  id: number;
  title: string;
  version: number;
}

/** 曲目别名。 */
export interface ChunithmAlias {
  song_id: number;
  aliases: string[];
}

/** 曲目列表（公共接口，无信封）。 */
export interface ChunithmSongList {
  songs: ChunithmSong[];
  genres: ChunithmGenre[];
  versions: ChunithmVersion[];
}

/** 别名列表（公共接口，无信封）。 */
export interface ChunithmAliasList {
  aliases: ChunithmAlias[];
}

/** 单曲最佳成绩查询参数。 */
export interface ChunithmBestQuery {
  song_id?: number | undefined;
  song_name?: string | undefined;
  level_index?: number | undefined;
}
