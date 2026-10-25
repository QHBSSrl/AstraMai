/**
 * 舞立方的成绩组装。
 *
 * ── 战力（Rating）怎么算 ────────────────────────────────────────────
 *
 * 这是**从 `DanceCubeBot` 的 `RatioCalculator` 里读出来的规则**，
 * 不是我们猜的：
 *
 *     单曲战力 = 准确率 × (等级 + 2)
 *     总战力   = B15 的平均 + Recent15 的平均
 *
 * `B15`  = 所有打过的谱里，战力最高的 15 个
 * `Recent15` = 最近打的 15 个
 *
 * ⚠️ 参考项目是 GPL-3.0。**这里是根据规则自己写的实现**，
 * 没有复制它的代码 —— 算法本身是数学，接口字段是事实。
 *
 * ── 为什么 B15 要拉 5 个曲风 ──────────────────────────────────────
 *
 * 上游只有 `GetMyRankNew?musicIndex=N`，按曲风分开返回。
 * 想凑出「我所有谱里的 Top 15」就必须把 2/3/4/5/6 五个曲风都拉一遍。
 * 这是上游的设计，我们没有别的选择。
 */

import type {
  DanceCubeChart,
  DanceCubePlayer,
  DanceCubeScore,
  DanceCubeScoreEntry,
  DanceCubeView,
} from './types.js';

/** B15 取前几名。 */
const BEST_COUNT = 15;

/** Recent 取前几名。 */
const RECENT_COUNT = 15;

/**
 * 单曲战力。
 *
 * `accuracy` 是 0–1 的准确率，`level` 是 1–19 的等级。
 *
 * 为什么 `+ 2`：舞立方的等级从 1 开始，但战力公式把它当 3 起步 ——
 * 1 级谱打满也有 3 × 1 = 3 战力。这是游戏的口径，不是笔误。
 */
export function scoreRatio(accuracy: number, level: number): number {
  if (!Number.isFinite(accuracy) || !Number.isFinite(level)) return 0;
  return accuracy * (level + 2);
}

/** 平均，空列表返回 0（不返回 NaN，避免 UI 上出现 `NaN`）。 */
function average(values: number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}

/** 按战力降序取前 N 个。 */
function topByRatio(charts: DanceCubeScore[], count: number): DanceCubeScore[] {
  return [...charts].sort((a, b) => b.ratio - a.ratio).slice(0, count);
}

/** 难度标签：show 谱显示 `show 12`，经典谱只显示等级。 */
function difficultyLabel(levelKind: number, difficulty: number, level: number): string {
  // show 谱的 difficulty 是 -1，levelKind 是 10
  if (levelKind === 10 || difficulty === -1) return `show ${level}`;
  return String(level);
}

/** 一条成绩 → 视图里的一行。 */
export function toScoreEntry(score: DanceCubeScore, position: number): DanceCubeScoreEntry {
  const isShow = score.levelKind === 10 || score.difficulty === -1;

  return {
    position,
    musicId: score.musicId,
    name: score.name,
    difficulty: difficultyLabel(score.levelKind, score.difficulty, score.level),
    level: score.level,
    levelText: isShow ? `show ${score.level}` : String(score.level),
    ratio: score.ratio,
    ratioText: score.ratio.toFixed(2),
    accuracy: score.accuracy,
    accuracyText: `${(score.accuracy * 100).toFixed(2)}%`,
    score: score.score,
    scoreText: score.score.toLocaleString('en-US'),
    combo: score.combo,
    miss: score.miss,
    ranking: score.ranking,
    rankingText: score.ranking > 0 ? `#${score.ranking}` : '—',
    isShow,
  };
}

/**
 * `GetMyRankNew` 的一项（一首曲目 + 它下面我打过的谱面）→ 平铺成多条成绩。
 *
 * 一首曲目可能有多个谱面（经典 + show，或者多个难度），
 * 每个谱面是一条独立成绩，都要参与排序。
 */
export function flattenRankItem(item: {
  musicId: number;
  name: string;
  ownerType: number;
  charts: DanceCubeChart[];
}): DanceCubeScore[] {
  return item.charts.map((chart) => ({
    musicId: item.musicId,
    name: item.name,
    difficulty: chart.difficulty,
    level: chart.level,
    levelKind: chart.levelKind,
    // 上游给的是百分比（比如 98.5），这里统一成 0–1
    accuracy: chart.percent / 100,
    score: chart.score,
    combo: chart.comboCount,
    miss: chart.miss,
    ratio: scoreRatio(chart.percent / 100, chart.level),
    ranking: chart.ranking,
  }));
}

/** 组装视图。 */
export function buildDanceCubeView(input: {
  player: DanceCubePlayer;
  /** 5 个曲风拉回来的全部成绩。 */
  allCharts: DanceCubeScore[];
  /** `GetLastPlay` 拉回来的最近成绩。 */
  recentCharts: DanceCubeScore[];
}): DanceCubeView {
  const best15Raw = topByRatio(input.allCharts, BEST_COUNT);
  const recent15Raw = input.recentCharts.slice(0, RECENT_COUNT);

  const bestAvg = average(best15Raw.map((score) => score.ratio));
  const recentAvg = average(recent15Raw.map((score) => score.ratio));
  const topRatio = best15Raw.length > 0 ? best15Raw[0]!.ratio : 0;

  return {
    game: 'dancecube',
    player: {
      userId: input.player.userId,
      name: input.player.name,
      avatarUrl: input.player.avatarUrl,
      titleUrl: input.player.titleUrl,
      ratio: input.player.ratio,
      ratioText: String(Math.round(input.player.ratio)),
      musicScore: input.player.musicScore,
      musicScoreText: input.player.musicScore.toLocaleString('en-US'),
      rankNation: input.player.rankNation,
      rankNationText: input.player.rankNation > 0 ? `#${input.player.rankNation}` : '—',
      // 上游是「百分之几 × 100」（518 → 5.18%），要除回去
      comboPercentText: `${(input.player.comboPercent / 100).toFixed(2)}%`,
      cityName: input.player.cityName,
      teamName: input.player.teamName,
    },
    best15: best15Raw.map(toScoreEntry),
    recent15: recent15Raw.map(toScoreEntry),
    stats: {
      bestAvg,
      bestAvgText: bestAvg.toFixed(2),
      recentAvg,
      recentAvgText: recentAvg.toFixed(2),
      totalRatio: bestAvg + recentAvg,
      totalRatioText: (bestAvg + recentAvg).toFixed(2),
      topRatio,
      topRatioText: topRatio.toFixed(2),
      totalCharts: input.allCharts.length,
    },
  };
}
