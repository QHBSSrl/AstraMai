/**
 * Phigros 成绩视图组装。
 *
 * 数据来自 `/save`，它一次给三块：
 *   `save.game_record`  按「曲名.曲师」为键的**字典**，值是该曲各难度成绩数组
 *   `rks.b30Charts`     B30 列表，但**只有 {songId, difficulty, rks}**
 *   `gradeCounts`       按难度的 C / FC / P 统计
 *
 * ⚠️ 关键点：**B30 里没有分数和准确率**。
 * 要显示这些必须拿 songId + difficulty 回去查 `game_record`。
 * 不查的话界面上只能显示一个 RKS 数字，玩家看不出打的是哪首、多少分。
 *
 * ⚠️ 第二个坑：`game_record` 是**字典不是数组**。
 * 当成数组遍历会静默拿到空结果——不报错，就是什么都没有。
 */

import type {
  PhigrosB30Chart,
  PhigrosDifficulty,
  PhigrosRecord,
  PhigrosSaveResponse,
} from './types.js';

/** Phigros 难度顺序。**只有四档**，AT 不是每首都有。 */
export const PHIGROS_DIFFICULTIES: readonly PhigrosDifficulty[] = ['EZ', 'HD', 'IN', 'AT'];

/**
 * Phigros 难度配色，贴近游戏内。
 * AT 用暗金——它是特殊谱面（和 EZ/HD/IN 不是一回事）。
 */
export const PHIGROS_DIFFICULTY_COLORS: Record<string, string> = {
  EZ: '#4fd6ff', // 蓝
  HD: '#7ee081', // 绿
  IN: '#f2564b', // 红
  AT: '#c9a227', // 暗金（特殊谱面）
};

export const PHIGROS_UNKNOWN_COLOR = '#9bacd0';

export function phigrosDifficultyColor(difficulty: string): string {
  return PHIGROS_DIFFICULTY_COLORS[difficulty] ?? PHIGROS_UNKNOWN_COLOR;
}

/** 推分提示类型 → 中文。上游给的是一组固定枚举。 */
export const PHIGROS_PUSH_LABELS: Record<string, string> = {
  already_phi: '已满分',
  phi_only: '只能冲满分',
  target_acc: '目标精度',
  unreachable: '暂难提升',
};

/** 单条成绩（已和存档记录关联）。 */
export interface PhigrosEntry {
  /** 曲目 id（「曲名.曲师」归一化后的形式）。 */
  songId: string;
  /** 展示用曲名。**从 id 里拆**——搜索接口才有正式曲名，这里没有。 */
  title: string;
  difficulty: PhigrosDifficulty;
  /** 该谱面对 RKS 的贡献。B30 才有；非 B30 的条目为 null。 */
  rks: number | null;
  score: number | null;
  accuracy: number | null;
  isFullCombo: boolean;
  chartConstant: number | null;
  color: string;
  /** 推分提示，可读文案。 */
  pushHint: string | null;
  pushTargetAcc: number | null;
  /** 是否在 B30 里。 */
  inBest30: boolean;
}

export interface PhigrosViewStats {
  rks: number;
  best30Count: number;
  /** 存档里一共有多少条成绩（所有难度合计）。 */
  recordCount: number;
  /** 出现过的难度。 */
  difficultiesPresent: string[];
  /** 各难度的 FC 数合计。 */
  fullComboCount: number;
  /** 满分（100 万）条数。 */
  phiCount: number;
}

export interface PhigrosView {
  game: 'phigros';
  nickname: string;
  rks: number;
  /** B30，按 RKS 降序。 */
  best30: PhigrosEntry[];
  stats: PhigrosViewStats;
  /** 存档更新时间。 */
  saveUpdatedAt: string | null;
  /** 挑战模式段位。 */
  challengeModeRank: number | null;
  generatedAt: string;
}

/**
 * 从「曲名.曲师」形式的 id 里拆出曲名。
 *
 * id 的规则是 `曲名.曲师`，但**曲名和曲师本身可能含点**，
 * 所以不能简单按第一个点切——那样 `A.B.C` 会拆错。
 * 这里只取第一个点之前的部分作为曲名，因为**平台自己就是这么归一化拼的**：
 * 实测 `Spasmodic` + `姜米條☆颶風 ~ ♫元力上人♫` 得到
 * `Spasmodic.姜米條颶風元力上人`（符号被去掉、以点连接）。
 *
 * 拆分失败时原样返回，不返回空串——**看得见一个奇怪的 id 比看不见强**。
 */
export function titleFromSongId(songId: string): string {
  if (!songId) return '';
  const dot = songId.indexOf('.');
  return dot > 0 ? songId.slice(0, dot) : songId;
}

/** 在存档字典里找某首歌某个难度的成绩。 */
function findRecord(
  gameRecord: Record<string, PhigrosRecord[]>,
  songId: string,
  difficulty: string,
): PhigrosRecord | null {
  const list = gameRecord[songId];
  if (!list) return null;
  return list.find((item) => item.difficulty === difficulty) ?? null;
}

/** 把一条（B30 或普通）成绩转成可渲染条目。 */
function toEntry(
  songId: string,
  difficulty: PhigrosDifficulty,
  record: PhigrosRecord | null,
  rks: number | null,
  inBest30: boolean,
): PhigrosEntry {
  return {
    songId,
    title: titleFromSongId(songId),
    difficulty,
    rks,
    score: record ? record.score : null,
    accuracy: record ? record.accuracy : null,
    isFullCombo: record ? Boolean(record.is_full_combo) : false,
    chartConstant: record ? record.chart_constant : null,
    color: phigrosDifficultyColor(difficulty),
    pushHint: record ? (PHIGROS_PUSH_LABELS[record.push_acc_hint?.type] ?? null) : null,
    pushTargetAcc:
      record && record.push_acc_hint && typeof record.push_acc_hint.acc === 'number'
        ? record.push_acc_hint.acc
        : null,
    inBest30,
  };
}

/** 组装 Phigros 视图。 */
export function buildPhigrosView(
  response: PhigrosSaveResponse,
  options: { limit?: number | undefined; generatedAt?: string | undefined } = {},
): PhigrosView {
  const gameRecord = response.save?.game_record ?? {};
  const b30 = response.rks?.b30Charts ?? [];
  const limit = options.limit ?? 30;

  // ── B30：按 RKS 降序，再去字典里补齐分数与准确率 ──
  const best30 = b30
    .slice()
    .sort((a, b) => (b.rks ?? 0) - (a.rks ?? 0))
    .slice(0, limit)
    .map((chart: PhigrosB30Chart) =>
      toEntry(
        chart.songId,
        chart.difficulty,
        findRecord(gameRecord, chart.songId, chart.difficulty),
        typeof chart.rks === 'number' ? chart.rks : null,
        true,
      ),
    );

  // ── 统计：遍历字典（**不是数组**）──
  let recordCount = 0;
  let fullComboCount = 0;
  let phiCount = 0;
  const difficultiesPresent = new Set<string>();

  for (const songId of Object.keys(gameRecord)) {
    for (const record of gameRecord[songId] ?? []) {
      recordCount += 1;
      difficultiesPresent.add(record.difficulty);
      if (record.is_full_combo) fullComboCount += 1;
      // Phigros 满分是 1000000
      if (record.score >= 1_000_000) phiCount += 1;
    }
  }

  const summary = response.save?.summaryParsed;

  return {
    game: 'phigros',
    nickname: response.nickname ?? '',
    rks: typeof response.rks?.totalRks === 'number' ? response.rks.totalRks : 0,
    best30,
    stats: {
      rks: typeof response.rks?.totalRks === 'number' ? response.rks.totalRks : 0,
      best30Count: best30.length,
      recordCount,
      difficultiesPresent: [...difficultiesPresent].sort(),
      fullComboCount,
      phiCount,
    },
    saveUpdatedAt: response.save?.updatedAt ?? null,
    challengeModeRank:
      summary && typeof summary.challenge_mode_rank === 'number' ? summary.challenge_mode_rank : null,
    generatedAt: options.generatedAt ?? new Date().toISOString(),
  };
}
