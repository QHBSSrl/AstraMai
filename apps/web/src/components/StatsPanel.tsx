import type { B50Stats } from '@astramai/core';
import { RATE_COLORS, RATE_LABELS, formatAchievement, formatFixed, formatInt } from '@astramai/core';

interface StatsPanelProps {
  stats: B50Stats;
}

/** 汇总统计：一眼看清这份 B50 的「体质」。 */
export function StatsPanel({ stats }: StatsPanelProps) {
  const items: { label: string; value: string; sub?: string; color?: string }[] = [
    {
      label: '参战谱面',
      value: formatInt(stats.chartCount),
      sub: `旧曲 ${formatInt(stats.standardCount)} / 新曲 ${formatInt(stats.dxCount)}`,
    },
    {
      label: '平均定数',
      value: formatFixed(stats.averageLevelValue, 2),
      sub: `最高 ${formatFixed(stats.maxLevelValue, 1)}`,
    },
    {
      label: '平均达成率',
      value: `${formatFixed(stats.averageAchievement, 3)}%`,
      sub: `最低 ${formatAchievement(stats.minAchievement)}`,
    },
    {
      label: 'AP 数',
      value: formatInt(stats.allPerfectCount),
      sub: `有 FC 记录 ${formatInt(stats.fullComboCount)}`,
      color: '#a7f3d0',
    },
    {
      label: 'FS 数',
      value: formatInt(stats.fullSyncCount),
      sub: '含 SYNC / FS / FDX 全档',
      color: '#bae6fd',
    },
    {
      label: '理论值总分',
      value: formatInt(stats.theoreticalMaxTotal),
      sub: `还差 ${formatInt(stats.gapToTheoretical)}`,
      color: '#f7d34e',
    },
    {
      label: '本地公式合计',
      value: formatInt(stats.computedTotal),
      sub:
        stats.computedDelta === 0
          ? '与落雪完全一致'
          : `与落雪相差 ${stats.computedDelta > 0 ? '+' : ''}${stats.computedDelta}`,
      color: stats.computedDelta === 0 ? '#a7f3d0' : '#fecaca',
    },
  ];

  return (
    <section className="card stats">
      <h3 className="card__title">统计</h3>
      <div className="stats__grid">
        {items.map((item) => (
          <div className="stat" key={item.label}>
            <div className="stat__label">{item.label}</div>
            <div className="stat__value" style={item.color ? { color: item.color } : undefined}>
              {item.value}
            </div>
            {item.sub ? <div className="stat__sub">{item.sub}</div> : null}
          </div>
        ))}
      </div>

      {stats.levelBuckets.length > 0 ? (
        <>
          <h3 className="card__title" style={{ marginTop: 20 }}>
            定数分布
          </h3>
          <LevelDistribution stats={stats} />
        </>
      ) : null}

      {stats.rateCounts.length > 0 ? (
        <>
          <h3 className="card__title" style={{ marginTop: 20 }}>
            评级分布
          </h3>
          <div className="chips">
            {stats.rateCounts.map((item) => (
              <span
                className="chip"
                key={item.rate}
                style={{
                  color: RATE_COLORS[item.rate],
                  borderColor: `${RATE_COLORS[item.rate]}66`,
                  background: `${RATE_COLORS[item.rate]}1f`,
                }}
              >
                {RATE_LABELS[item.rate]} × {item.count}
              </span>
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
}

/** 定数分布条形图：横轴定数，条形长度表示曲数，颜色表示该定数下的平均达成率。 */
function LevelDistribution({ stats }: StatsPanelProps) {
  const maxCount = Math.max(...stats.levelBuckets.map((bucket) => bucket.count), 1);

  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {stats.levelBuckets.map((bucket) => (
        <div
          key={bucket.levelValue}
          style={{ display: 'grid', gridTemplateColumns: '56px 1fr 116px', gap: 10, alignItems: 'center' }}
        >
          <span className="score-row__meta" style={{ textAlign: 'right' }}>
            {bucket.levelValue.toFixed(1)}
          </span>
          <span
            style={{
              display: 'block',
              height: 12,
              borderRadius: 999,
              background: achievementRamp(bucket.averageAchievement),
              width: `${(bucket.count / maxCount) * 100}%`,
              minWidth: 6,
              border: '1px solid rgba(120,150,210,0.2)',
            }}
            title={`${bucket.count} 首，平均达成率 ${bucket.averageAchievement.toFixed(4)}%`}
          />
          <span className="score-row__meta">
            {bucket.count} 首 · {bucket.averageAchievement.toFixed(3)}%
          </span>
        </div>
      ))}
    </div>
  );
}

/** 平均达成率 → 颜色：98% 冷蓝、99.5% 紫、101% 品红。 */
const RAMP_STOPS: [number, number, number][] = [
  [79, 214, 255],
  [179, 136, 255],
  [255, 95, 158],
];

function achievementRamp(achievement: number): string {
  const t = Math.min(Math.max((achievement - 98) / 3, 0), 1);
  const scaled = t * (RAMP_STOPS.length - 1);
  const index = Math.min(Math.floor(scaled), RAMP_STOPS.length - 2);
  const local = scaled - index;
  const from = RAMP_STOPS[index]!;
  const to = RAMP_STOPS[index + 1]!;
  const mix = from.map((channel, i) => Math.round(channel + (to[i]! - channel) * local));
  return `rgb(${mix[0]}, ${mix[1]}, ${mix[2]})`;
}
