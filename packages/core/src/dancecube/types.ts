/**
 * 舞立方（DanceCube）的类型。
 *
 * ── 这个游戏和别的音游不一样在哪 ────────────────────────────────────
 *
 * 舞萌、中二、osu 都有「一次拿全部成绩」的接口，我们拿到之后自己取 Top N。
 *
 * **舞立方没有。** 它只有：
 *   · `GetMyRankNew?musicIndex=N` —— 按曲风分 5 类，每类返回「我在这个曲风里
 *     打过的每一首的成绩 + 排名」
 *   · `GetLastPlay` —— 最近打的
 *
 * 所以要凑出 B15，得**把 5 个曲风全拉一遍**再排序。
 * 这是上游的设计，绕不过去 —— 但它有个好处：一次拿到的是**全部成绩**，
 * 不只是 Top 15，所以以后想做「全谱面列表」不用再请求。
 *
 * ── 所有 JSON 键都是 PascalCase ──────────────────────────────────────
 *
 * 上游（盛华娱乐）是 .NET 后端，字段全是 `UserID` / `LvRatio` / `PlayerScore`
 * 这种写法。**不是** camelCase，也不是 snake_case。
 */

/** 曲风分类（`GetMyRankNew` 的 `musicIndex`）。 */
export const DANCECUBE_CATEGORIES = [2, 3, 4, 5, 6] as const;

/**
 * 曲风的中文名。
 *
 * 来源：`DanceCubeBot` 的 `RatioCalculator.getAllRankList` 里那行注释
 * `// 2 3 4 5 6 国语 粤语 韩语 欧美 其它`。
 */
export const DANCECUBE_CATEGORY_LABEL: Record<number, string> = {
  2: '国语',
  3: '粤语',
  4: '韩语',
  5: '欧美',
  6: '其它',
};

/** 谱面类型：1 = 经典，10 = show。 */
export const DANCECUBE_LEVEL_KIND = { CLASSIC: 1, SHOW: 10 } as const;

/**
 * 玩家信息（`/Dance/api/User/GetInfo?userId=`）。
 *
 * ⚠️ 这个接口**会返回手机号**（`Phone`）。我们**不存、不显示、不记录**它 ——
 * 只在解析时丢掉。用户没同意把手机号给第三方工具。
 */
export interface DanceCubePlayer {
  /** 用户 ID。 */
  userId: number;
  /** 玩家名。 */
  name: string;
  /** 头像地址。 */
  avatarUrl: string;
  /** **战力**（游戏内的 Rating）。 */
  ratio: number;
  /** 舞力（另一个分数，不是 Rating）。 */
  musicScore: number;
  /** 全国排名。 */
  rankNation: number;
  /** 全连率，例如 518 表示 5.18%。上游给的是「百分之几 × 100」。 */
  comboPercent: number;
  /** 城市。 */
  cityName: string;
  /** 战队名，可能为空。 */
  teamName: string;
  /** 头衔图 URL，可能为空。 */
  titleUrl: string;
}

/** 一条成绩（来自 `GetMyRankNew` 或 `GetLastPlay`）。 */
export interface DanceCubeScore {
  /** 曲目 ID。 */
  musicId: number;
  /** 曲名。 */
  name: string;
  /**
   * 难度编号。
   *
   * `-1` 表示 show（表演谱），其余对应经典谱的难度序号。
   */
  difficulty: number;
  /** 等级（1–19）。 */
  level: number;
  /** 谱面类型：1 = 经典，10 = show。 */
  levelKind: number;
  /** 准确率（0–1）。上游给的是百分比，这里已经除过 100。 */
  accuracy: number;
  /** 分数。 */
  score: number;
  /** 最大连击。 */
  combo: number;
  /** MISS 数。 */
  miss: number;
  /** 战力 = `accuracy × (level + 2)`。 */
  ratio: number;
  /** 这首歌上我的排名。`GetLastPlay` 没有这个字段，那里是 0。 */
  ranking: number;
}

/** 一个曲风分类下的一首歌（`GetMyRankNew` 的返回项）。 */
export interface DanceCubeRankItem {
  musicId: number;
  name: string;
  /** 1 = 官方曲，0 = 玩家自制。 */
  ownerType: number;
  /** 这个曲目下我打过的所有谱面。 */
  charts: DanceCubeChart[];
}

/** `ItemRankList` 里的一项 —— 一个谱面的成绩。 */
export interface DanceCubeChart {
  /** 难度编号。`-1` = show。 */
  difficulty: number;
  /** 等级。 */
  level: number;
  /** 1 = 经典，10 = show。 */
  levelKind: number;
  /** 百分比（0–100+），**没除 100**，保持上游原样。 */
  percent: number;
  /** 分数。 */
  score: number;
  /** 连击数。 */
  comboCount: number;
  /** MISS 数。 */
  miss: number;
  /** 这首谱上的排名。 */
  ranking: number;
}

/** 组装好的视图（给手表渲染用）。 */
export interface DanceCubeView {
  game: 'dancecube';
  player: {
    userId: number;
    name: string;
    avatarUrl: string;
    titleUrl: string;
    /** 战力，整数。 */
    ratio: number;
    ratioText: string;
    /** 舞力。 */
    musicScore: number;
    musicScoreText: string;
    /** 全国排名；0 表示没上榜。 */
    rankNation: number;
    rankNationText: string;
    comboPercentText: string;
    cityName: string;
    teamName: string;
  };
  /** B15：战力最高的 15 首。 */
  best15: DanceCubeScoreEntry[];
  /** 最近 15 首。 */
  recent15: DanceCubeScoreEntry[];
  stats: {
    /** B15 的平均战力。 */
    bestAvg: number;
    bestAvgText: string;
    /** Recent15 的平均战力。 */
    recentAvg: number;
    recentAvgText: string;
    /** 两段相加 —— 游戏内的战力口径。 */
    totalRatio: number;
    totalRatioText: string;
    /** B15 里最高的一首战力。 */
    topRatio: number;
    topRatioText: string;
    /** 一共拉到多少条成绩（5 个曲风加起来）。 */
    totalCharts: number;
  };
}

/** 视图里的一行（字段名和舞萌那套对齐，方便手表复用同一份模板）。 */
export interface DanceCubeScoreEntry {
  position: number;
  musicId: number;
  name: string;
  /** 难度标签，比如 `10` / `show 12`。 */
  difficulty: string;
  level: number;
  levelText: string;
  /** 这一首的战力。 */
  ratio: number;
  ratioText: string;
  accuracy: number;
  accuracyText: string;
  score: number;
  scoreText: string;
  combo: number;
  miss: number;
  /** 排名；0 表示没有。 */
  ranking: number;
  rankingText: string;
  isShow: boolean;
}
