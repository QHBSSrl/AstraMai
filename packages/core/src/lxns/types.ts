/**
 * 落雪查分器（LXNS）API 数据类型。
 *
 * 依据文档整理：
 * - 舞萌 DX：https://maimai.lxns.net/docs/api/maimai
 * - 中二节奏：https://maimai.lxns.net/docs/api/chunithm
 * - 鉴权：https://maimai.lxns.net/docs/developer-guide
 *
 * 说明：本文件只描述字段形状，不做校验。所有时间均为 UTC。
 */

// ── 枚举 ────────────────────────────────────────────────────────────────

/** 谱面难度下标。宴会场曲目该字段为 0。 */
export type LevelIndex = 0 | 1 | 2 | 3 | 4;

/** 谱面类型。`utage` 仅宴会场曲目（曲目 ID > 100000）使用。 */
export type SongType = 'standard' | 'dx' | 'utage';

/** FULL COMBO 类型。 */
export type FCType = 'app' | 'ap' | 'fcp' | 'fc';

/** FULL SYNC 类型。 */
export type FSType = 'fsdp' | 'fsd' | 'fsp' | 'fs' | 'sync';

/** 评级类型。 */
export type RateType =
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

/** 称号颜色。 */
export type TrophyColor = 'normal' | 'bronze' | 'silver' | 'gold' | 'rainbow';

// ── 通用响应包装 ────────────────────────────────────────────────────────

/**
 * 开发者 API / 个人 API 的标准响应包装。
 *
 * 注意：落雪并非所有接口都带这层包装——公共接口（如 `song/list`）
 * 直接返回裸对象。客户端需两种都兼容，见 `unwrapEnvelope`。
 */
export interface ApiEnvelope<T> {
  success: boolean;
  code: number;
  message?: string | null;
  data: T | null;
}

// ── 收藏品 ──────────────────────────────────────────────────────────────

export interface Trophy {
  id: number;
  name?: string;
  genre?: string;
  color?: TrophyColor | null;
}

export interface Icon {
  id: number;
  name?: string;
  genre?: string;
}

export interface NamePlate {
  id: number;
  name?: string;
  genre?: string;
}

export interface Frame {
  id: number;
  name?: string;
  genre?: string;
}

/** 收藏品（`/maimai/{collection_type}/list` 返回项）。 */
export interface Collection {
  id: number;
  name: string;
  color?: TrophyColor | null;
  description?: string | null;
  genre?: string | null;
  required?: CollectionRequired[] | null;
}

export interface CollectionRequired {
  difficulties?: LevelIndex[] | null;
  rate?: RateType | null;
  fc?: FCType | null;
  fs?: FSType | null;
  songs?: CollectionRequiredSong[] | null;
  completed?: boolean | null;
}

export interface CollectionRequiredSong {
  id: number;
  title: string;
  type: SongType;
  completed?: boolean | null;
  completed_difficulties?: LevelIndex[] | null;
}

// ── 玩家 ────────────────────────────────────────────────────────────────

export interface MaimaiPlayer {
  name: string;
  /** 玩家 DX Rating。 */
  rating: number;
  friend_code: number;
  /** 段位 ID。 */
  course_rank: number;
  /** 阶级 ID。 */
  class_rank: number;
  /** 搭档觉醒数。 */
  star: number;
  trophy?: Trophy | null;
  icon?: Icon | null;
  name_plate?: NamePlate | null;
  frame?: Frame | null;
  /** 仅获取玩家信息时返回：玩家被同步时的 UTC 时间。 */
  upload_time?: string;
}

// ── 成绩 ────────────────────────────────────────────────────────────────

/** 游玩成绩。 */
export interface MaimaiScore {
  /** 曲目 ID。标准 / DX 谱面共用同一 ID；宴会场曲目 ID > 100000。 */
  id: number;
  /** 仅获取 Score 时返回：曲名。 */
  song_name?: string;
  /** 仅获取 Score 时返回：难度标级，如 `14+`。 */
  level?: string;
  level_index: LevelIndex;
  /** 达成率，如 100.5。 */
  achievements: number;
  fc?: FCType | null;
  fs?: FSType | null;
  dx_score: number;
  /** DX 星级，最大 5。 */
  dx_star?: number;
  /** 仅获取 Score 时返回：DX Rating（浮点，展示时向下取整）。 */
  dx_rating?: number;
  /** 仅获取 Score 时返回：评级类型。 */
  rate?: RateType;
  type: SongType;
  play_time?: string | null;
  upload_time?: string | null;
  last_played_time?: string | null;
}

/** 游玩成绩（简化）。 */
export interface MaimaiSimpleScore {
  id: number;
  song_name: string;
  level: string;
  level_index: LevelIndex;
  fc?: FCType | null;
  fs?: FSType | null;
  rate: RateType;
  type: SongType;
}

/** Best 50 响应体。 */
export interface MaimaiBests {
  /** 旧版本谱面 Best 35 总分。 */
  standard_total: number;
  /** 现版本谱面 Best 15 总分。 */
  dx_total: number;
  standard: MaimaiScore[];
  dx: MaimaiScore[];
  /** 旧版本 Selection 10。 */
  standard_selections?: MaimaiScore[];
  /** 现版本 Selection 10。 */
  dx_selections?: MaimaiScore[];
}

// ── 曲目 ────────────────────────────────────────────────────────────────

export interface MaimaiNotes {
  total: number;
  tap: number;
  hold: number;
  slide: number;
  touch: number;
  break: number;
}

export interface MaimaiBuddyNotes {
  left: MaimaiNotes;
  right: MaimaiNotes;
}

export interface MaimaiSongDifficulty {
  type: SongType;
  difficulty: LevelIndex;
  /** 难度标级，如 `14+`。 */
  level: string;
  /** 谱面定数。 */
  level_value: number;
  note_designer: string;
  /** 谱面首次出现版本。 */
  version: number;
  notes?: MaimaiNotes | MaimaiBuddyNotes | null;
}

export interface MaimaiSongDifficultyUtage extends MaimaiSongDifficulty {
  /** 谱面属性。 */
  kanji: string;
  description: string;
  is_buddy: boolean;
}

export interface MaimaiSongDifficulties {
  standard: MaimaiSongDifficulty[];
  dx: MaimaiSongDifficulty[];
  /** 仅宴会场曲目（ID > 100000）拥有。 */
  utage?: MaimaiSongDifficultyUtage[];
}

export interface MaimaiSong {
  id: number;
  title: string;
  artist: string;
  genre: string;
  bpm: number;
  /** 曲目所属区域，可为空。 */
  map?: string | null;
  /** 曲目首次出现版本。 */
  version: number;
  rights?: string | null;
  locked?: boolean;
  disabled?: boolean;
  difficulties: MaimaiSongDifficulties;
}

export interface MaimaiGenre {
  id: number;
  title: string;
  genre: string;
}

export interface MaimaiVersion {
  id: number;
  title: string;
  version: number;
}

export interface MaimaiSongList {
  songs: MaimaiSong[];
  genres: MaimaiGenre[];
  versions: MaimaiVersion[];
}

export interface MaimaiAlias {
  song_id: number;
  aliases: string[];
}

export interface MaimaiAliasList {
  aliases: MaimaiAlias[];
}

/** DX Rating 趋势点。 */
export interface MaimaiRatingTrend {
  total: number;
  standard: number;
  dx: number;
  date: string;
}

// ── 游戏资源 ────────────────────────────────────────────────────────────

/** 舞萌 DX 资源基础 URL。 */
export const MAIMAI_ASSET_BASE = 'https://assets2.lxns.net/maimai';
