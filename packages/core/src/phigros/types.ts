/**
 * Phigros Query 开放平台 API 类型。
 *
 * 平台：https://lilith.xtower.site/api-docs/
 * 后端：https://r0semi.xtower.site/api/v1/open/
 * 鉴权：请求头 `X-OpenApi-Token: <开放平台密钥>`（**我们的密钥，不是玩家的**）
 *
 * ── 和落雪最大的不同 ────────────────────────────────────────────────
 *
 * 1. **玩家标识是 `sessionToken`，来自 TapTap 扫码登录。**
 *    落雪是「一把密钥查任何人」；Phigros 是「玩家自己授权，我们查他自己」。
 *    所以接入模型完全不同，不能套用 LxnsSource 那套。
 *
 * 2. **没有全量曲库接口。** 只有 `GET /songs/search?q=` 和 `/new-songs`。
 *    想要完整曲库得靠搜索一点点攒，或者另找资源。
 *
 * 3. **曲绘不在 API 里。** 曲目信息只给 `illustrator`（插画师名），没有图 URL。
 *
 * 4. 存档里的成绩是**按 `曲名.曲师` 为键的字典**，不是数组——
 *    这一点很容易写成数组处理而静默拿到空数据。
 *
 * ⚠️ 这个 key（pgr_test_...）是测试 key，正式接入要换生产 key，
 * 并确认它的 scope 与 rate limit。
 */

/** 开放平台错误响应（RFC 7807 风格）。 */
export interface PhigrosErrorBody {
  type: string;
  title: string;
  status: number;
  detail: string;
  code: string;
  requestId: string;
}

/** 难度标识。Phigros 只有四档，比中二简单。 */
export type PhigrosDifficulty = 'EZ' | 'HD' | 'IN' | 'AT';

/** 谱面定数。AT 可能为 null（不是每首都有 AT）。 */
export interface PhigrosChartConstants {
  ez: number;
  hd: number;
  in: number;
  at: number | null;
}

/** 曲目（来自搜索接口）。 */
export interface PhigrosSong {
  /**
   * 曲目 ID。
   * ⚠️ 是 `曲名.曲师` 拼出来的字符串（如 `Spasmodic.姜米條☆颶風 ~ ♫元力上人♫`），
   * **不是数字**。存档的键用的是同一套，两边能对上。
   */
  id: string;
  name: string;
  composer: string;
  illustrator: string;
  chartConstants: PhigrosChartConstants;
}

/** 曲目搜索响应。 */
export interface PhigrosSongSearch {
  items: PhigrosSong[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

/** 单条成绩。 */
export interface PhigrosRecord {
  difficulty: PhigrosDifficulty;
  score: number;
  /** 准确率，百分比数值（如 98.51）。 */
  accuracy: number;
  is_full_combo: boolean;
  chart_constant: number;
  /** 推分目标精度。 */
  push_acc: number;
  push_acc_hint: PhigrosPushHint;
}

/** 推分提示。`type` 取值见 `PHIGROS_PUSH_LABELS`。 */
export interface PhigrosPushHint {
  type: string;
  acc?: number;
}

/** B30 里的一条。 */
export interface PhigrosB30Chart {
  songId: string;
  difficulty: PhigrosDifficulty;
  /** 该谱面对 RKS 的贡献值。 */
  rks: number;
}

/** RKS 信息。 */
export interface PhigrosRks {
  totalRks: number;
  b30Charts: PhigrosB30Chart[];
}

/** 按难度统计的 C / FC / P 数量。 */
export interface PhigrosGradeStat {
  C: number;
  FC: number;
  P: number;
}

/** 存档主体。字段很多，这里只声明我们会用到的。 */
export interface PhigrosSave {
  /**
   * 歌曲记录。
   * **键是 `曲名.曲师`**（如 `Spasmodic.姜米條☆颶風 ~ ♫元力上人♫`），
   * 值是该曲各难度成绩的数组。
   */
  game_record: Record<string, PhigrosRecord[]>;
  summaryParsed?: {
    save_version?: number;
    challenge_mode_rank?: number;
    ranking_score?: number;
    game_version?: number;
    avatar?: string;
    progress?: number[];
  };
  updatedAt?: string;
}

/** `/save` 的完整响应。 */
export interface PhigrosSaveResponse {
  save: PhigrosSave;
  rks: PhigrosRks;
  gradeCounts: Record<string, PhigrosGradeStat>;
  nickname: string | null;
}

/** TapTap 扫码：生成二维码。 */
export interface PhigrosQrCode {
  qrId: string;
  /** 校验链接。可以用来自己生成二维码，不必使用 qrcodeBase64。 */
  verificationUrl: string;
  /** 二维码图片的 base64。 */
  qrcodeBase64: string;
}

/** TapTap 扫码：轮询登录状态。 */
export interface PhigrosQrStatus {
  status: string;
  /** 建议的再次轮询等待秒数。 */
  retryAfter?: number;
  /** 登录成功后才有。**这就是玩家凭证。** */
  sessionToken?: string;
}

/** TapTap 版本。 */
export type PhigrosTapTapVersion = 'cn' | 'global';
