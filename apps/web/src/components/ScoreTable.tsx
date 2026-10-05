import type { B50Entry } from '@astramai/core';
import {
  FC_LABELS,
  FS_LABELS,
  RATE_COLORS,
  RATE_LABELS,
  formatAchievement,
  formatDxScore,
  formatInt,
  formatLevelValue,
} from '@astramai/core';

export function entryKey(entry: B50Entry): string {
  return `${entry.type}-${entry.songId}-${entry.levelIndex}`;
}

interface ScoreTableProps {
  entries: B50Entry[];
  selectedKey: string | null;
  onSelect: (entry: B50Entry) => void;
  /** 是否显示名次列。 */
  showRank?: boolean;
  /** 起始名次。 */
  startRank?: number;
  emptyText?: string;
}

export function ScoreTable({
  entries,
  selectedKey,
  onSelect,
  showRank = true,
  startRank = 1,
  emptyText = '这个分组没有成绩。',
}: ScoreTableProps) {
  if (entries.length === 0) {
    return (
      <div className="card scores" style={{ padding: 24, color: 'var(--text-dim)' }}>
        {emptyText}
      </div>
    );
  }

  return (
    <div className="card scores">
      <div className="scores__header">
        <span style={{ textAlign: 'center' }}>#</span>
        <span>曲绘</span>
        <span>曲目</span>
        <span style={{ textAlign: 'right' }}>达成率</span>
        <span style={{ textAlign: 'right' }}>DX 分数</span>
        <span>标记</span>
        <span style={{ textAlign: 'right' }}>自检</span>
        <span style={{ textAlign: 'right' }}>Rating</span>
      </div>

      {entries.map((entry, index) => {
        const key = entryKey(entry);
        const selected = key === selectedKey;
        const mismatch = entry.verification?.matches === false;

        return (
          <div
            key={key}
            className="score-row"
            role="button"
            tabIndex={0}
            aria-selected={selected}
            onClick={() => onSelect(entry)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onSelect(entry);
              }
            }}
          >
            {showRank ? (
              <span className="score-row__rank cell-rank">{startRank + index}</span>
            ) : (
              <span className="score-row__rank cell-rank" />
            )}

            <img
              className="score-row__jacket cell-jacket"
              src={entry.jacketUrl}
              alt=""
              loading="lazy"
              onError={(event) => {
                event.currentTarget.style.visibility = 'hidden';
              }}
            />

            <div className="cell-title">
              <div className="score-row__name" title={entry.title}>
                <span
                  className="chip chip--diff"
                  style={{ background: entry.difficultyColor, marginRight: 8 }}
                  title={`${entry.difficulty} ${entry.level}`}
                >
                  {entry.difficultyShort}
                </span>
                <span
                  className="chip chip--level"
                  style={{ marginRight: 8 }}
                  title={`谱面定数 ${formatLevelValue(entry.levelValue)}`}
                >
                  {entry.level} · {formatLevelValue(entry.levelValue)}
                </span>
                {entry.title}
              </div>
              <div className="score-row__alias">
                {entry.aliases.length > 0 ? `${entry.aliases.slice(0, 3).join(' / ')} · ` : ''}
                {entry.artist || '未知艺术家'}
              </div>
            </div>

            <div className="score-row__num cell-ach">
              <div style={{ fontWeight: 700 }}>{formatAchievement(entry.achievements)}</div>
              <div style={{ color: RATE_COLORS[entry.rate], fontSize: 12, fontWeight: 700 }}>
                {RATE_LABELS[entry.rate]}
              </div>
            </div>

            <div className="score-row__num cell-dx">
              <div>{formatDxScore(entry.dxScore, entry.maxDxScore)}</div>
              <div style={{ color: 'var(--warn)', fontSize: 12 }}>
                {'★'.repeat(Math.max(0, Math.min(5, entry.dxStar)))}
              </div>
            </div>

            <div className="chips cell-marks">
              {entry.fc ? <span className={`chip chip--fc`}>{FC_LABELS[entry.fc]}</span> : null}
              {entry.fs ? <span className={`chip chip--fs`}>{FS_LABELS[entry.fs]}</span> : null}
              {!entry.fc && !entry.fs ? <span className="score-row__meta">—</span> : null}
            </div>

            <div className="cell-check" style={{ textAlign: 'right' }}>
              {entry.verification === null ? (
                <span className="score-row__meta">无定数</span>
              ) : entry.verification.api === null ? (
                <span className="score-row__meta" title="落雪未返回 dx_rating">
                  未提供
                </span>
              ) : mismatch ? (
                <span
                  className="chip chip--mismatch"
                  title={`本地算出 ${entry.verification.computed}，落雪返回 ${entry.verification.api}`}
                >
                  差 {entry.verification.computed - entry.verification.api}
                </span>
              ) : (
                <span className="chip chip--ok" title="本地公式与落雪一致">
                  ✓
                </span>
              )}
            </div>

            <div className="score-row__rating cell-rating">
              <div>{entry.rating ?? entry.computedRating ?? '--'}</div>
              {entry.headroom !== null && entry.headroom > 0 ? (
                <div
                  style={{ fontSize: 11, color: 'var(--text-faint)', fontWeight: 400 }}
                  title={`该谱面 AP+ 满分为 ${entry.maxRating}`}
                >
                  +{formatInt(entry.headroom)}
                </div>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
