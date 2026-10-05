import type { B50Entry } from '@astramai/core';
import {
  FC_LABELS,
  FS_LABELS,
  RATE_COLORS,
  RATE_LABELS,
  difficultyName,
  formatAchievement,
  formatDxScore,
  formatFixed,
  formatInt,
  formatLevelValue,
  formatUtcToLocal,
  musicUrl,
  projectRating,
} from '@astramai/core';
import { useEffect } from 'react';

interface ScoreDetailProps {
  entry: B50Entry;
  onClose: () => void;
}

/** 单条成绩的详情：以右侧抽屉（窄屏为底部抽屉）呈现，避免列表过长时找不到内容。 */
export function ScoreDetail({ entry, onClose }: ScoreDetailProps) {
  const verification = entry.verification;
  const projectedMax = projectRating(entry, 100.5);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return (
    <>
      <div className="detail-backdrop" onClick={onClose} aria-hidden />
      <aside className="detail-panel" role="dialog" aria-modal="true" aria-label={`${entry.title} 成绩详情`}>
        <div className="detail__close">
          <button className="btn btn--ghost btn--sm" type="button" onClick={onClose}>
            收起 ✕
          </button>
        </div>

        <section className="card detail">
      <div className="detail__head">
        <img
          className="detail__jacket"
          src={entry.jacketUrl}
          alt=""
          onError={(event) => {
            event.currentTarget.style.visibility = 'hidden';
          }}
        />

        <div style={{ minWidth: 0, flex: 1 }}>
          <h3 className="detail__title">{entry.title}</h3>
          <div className="detail__artist">
            {entry.artist || '未知艺术家'}
            {entry.bpm ? ` · BPM ${entry.bpm}` : ''}
            {entry.genre ? ` · ${entry.genre}` : ''}
          </div>

          {entry.aliases.length > 0 ? (
            <div className="chips" style={{ marginTop: 8 }}>
              {entry.aliases.map((alias) => (
                <span className="chip chip--level" key={alias}>
                  {alias}
                </span>
              ))}
            </div>
          ) : null}

          <div className="chips" style={{ marginTop: 10 }}>
            <span className="chip chip--diff" style={{ background: entry.difficultyColor }}>
              {difficultyName(entry.levelIndex)}
            </span>
            <span className="chip chip--level">
              Lv.{entry.level} · 定数 {formatLevelValue(entry.levelValue)}
            </span>
            <span
              className="chip"
              style={{
                color: RATE_COLORS[entry.rate],
                borderColor: `${RATE_COLORS[entry.rate]}66`,
                background: `${RATE_COLORS[entry.rate]}1f`,
              }}
            >
              {RATE_LABELS[entry.rate]}
            </span>
            {entry.fc ? <span className="chip chip--fc">{FC_LABELS[entry.fc]}</span> : null}
            {entry.fs ? <span className="chip chip--fs">{FS_LABELS[entry.fs]}</span> : null}
          </div>
        </div>
      </div>

      <div className="detail__grid">
        <Cell label="达成率" value={formatAchievement(entry.achievements)} />
        <Cell label="DX 分数" value={formatDxScore(entry.dxScore, entry.maxDxScore)} />
        <Cell label="DX 星级" value={`${entry.dxStar} / 5`} />
        <Cell label="单曲 Rating" value={formatInt(entry.rating ?? entry.computedRating)} accent />
        <Cell label="该谱面满分" value={formatInt(entry.maxRating)} />
        <Cell
          label="提升空间"
          value={entry.headroom !== null ? `+${formatInt(entry.headroom)}` : '--'}
        />
        <Cell label="打到 100.5%" value={projectedMax !== null ? `${projectedMax}` : '--'} sub="按当前定数推算" />
        <Cell label="谱师" value={entry.noteDesigner ?? '—'} mono={false} />
        <Cell label="最后游玩" value={formatUtcToLocal(entry.lastPlayedTime)} mono={false} />
      </div>

      {entry.notes ? (
        <>
          <h3 className="card__title" style={{ marginTop: 20 }}>
            谱面物量
          </h3>
          <div className="detail__notes">
            <Note label="TOTAL" value={entry.notes.total} />
            <Note label="TAP" value={entry.notes.tap} />
            <Note label="HOLD" value={entry.notes.hold} />
            <Note label="SLIDE" value={entry.notes.slide} />
            <Note label="TOUCH" value={entry.notes.touch} />
            <Note label="BREAK" value={entry.notes.break} />
          </div>
        </>
      ) : null}

      {verification ? (
        <>
          <h3 className="card__title" style={{ marginTop: 20 }}>
            Rating 拆解与对拍
          </h3>
          <div className="detail__grid">
            <Cell label="计算式" value={`floor(${verification.levelValue} × ${formatFixed(verification.achievement, 4)}% × ${verification.step.coefficient}${verification.apBonus ? ' + 1' : ''})`} mono />
            <Cell label="命中系数档" value={`${verification.step.coefficient}（${verification.step.note ?? '—'}）`} mono={false} />
            <Cell label="AP 加分" value={verification.apBonus ? '+1' : '无'} />
            <Cell label="本地结果" value={formatInt(verification.computed)} accent />
            <Cell label="落雪原始值" value={verification.apiRaw !== null ? String(verification.apiRaw) : '—'} />
            <Cell
              label="是否一致"
              value={
                verification.api === null ? '无数据' : verification.matches ? '一致' : `差 ${verification.computed - verification.api}`
              }
            />
          </div>
        </>
      ) : (
        <p style={{ color: 'var(--text-dim)', fontSize: 13, marginTop: 16 }}>
          曲库中缺少这首谱面的定数，无法用本地公式复核；界面直接展示落雪返回的 Rating。
        </p>
      )}

      <div style={{ marginTop: 18 }}>
        <audio controls preload="none" src={musicUrl(entry.songId)} style={{ width: '100%', maxWidth: 420 }}>
          你的浏览器不支持音频播放。
        </audio>
      </div>
        </section>
      </aside>
    </>
  );
}

function Cell({
  label,
  value,
  sub,
  accent,
  mono = true,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
  mono?: boolean;
}) {
  return (
    <div className="stat">
      <div className="stat__label">{label}</div>
      <div
        className="stat__value"
        style={{
          fontSize: 16,
          ...(accent ? { color: 'var(--accent)' } : {}),
          ...(mono ? {} : { fontFamily: 'inherit', fontSize: 14, fontWeight: 600 }),
        }}
      >
        {value}
      </div>
      {sub ? <div className="stat__sub">{sub}</div> : null}
    </div>
  );
}

function Note({ label, value }: { label: string; value: number }) {
  return (
    <div className="note-cell">
      <div className="note-cell__label">{label}</div>
      <div className="note-cell__value">{formatInt(value)}</div>
    </div>
  );
}
