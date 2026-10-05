import type { B50View, PlayerView } from '@astramai/core';
import { formatInt, formatRelative } from '@astramai/core';
import { useState } from 'react';

interface PlayerCardProps {
  view: B50View;
}

/** 玩家名片：左侧身份信息，右侧总 Rating 与 B35/B15 构成。 */
export function PlayerCard({ view }: PlayerCardProps) {
  const { player, stats } = view;
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  const hide = (key: string) => setFailed((prev) => ({ ...prev, [key]: true }));

  const composition = [
    { label: '旧曲 Best 35', value: stats.standardTotal, color: 'linear-gradient(90deg,#4fd6ff,#7aa2ff)' },
    { label: '新曲 Best 15', value: stats.dxTotal, color: 'linear-gradient(90deg,#ff5f9e,#ffa06b)' },
  ];
  const sum = Math.max(
    composition.reduce((acc, item) => acc + item.value, 0),
    1,
  );

  return (
    <section className="card player">
      <div className="player__identity">
        <div className="player__plate">
          {player.frameUrl && !failed.frame ? (
            <img className="player__frame" src={player.frameUrl} alt="" loading="lazy" onError={() => hide('frame')} />
          ) : null}
          {player.plateUrl && !failed.plate ? (
            <img src={player.plateUrl} alt="" loading="lazy" onError={() => hide('plate')} />
          ) : null}
          {player.iconUrl && !failed.icon ? (
            <img
              className="player__avatar"
              src={player.iconUrl}
              alt="头像"
              loading="lazy"
              onError={() => hide('icon')}
            />
          ) : (
            <span className="player__avatar" aria-hidden />
          )}
        </div>

        <div style={{ minWidth: 0 }}>
          <h2 className="player__name">{player.name}</h2>
          <div className="player__code">好友码 {player.friendCode ?? '—'}</div>

          <div className="player__metrics">
            <span>
              <b>{player.courseRank || '—'}</b>段位
            </span>
            <span>
              <b>{player.classRank || '—'}</b>阶级
            </span>
            <span>
              <b>{formatInt(player.star)}</b>搭档觉醒
            </span>
          </div>

          {player.trophyName ? (
            <div className="player__trophy">
              <span className="legend-dot" style={{ background: trophyColor(player.trophyColor) }} aria-hidden />
              称号：{player.trophyName}
            </div>
          ) : null}

          {player.uploadTime ? (
            <div className="score-row__meta" style={{ marginTop: 8 }}>
              数据同步于 {formatRelative(player.uploadTime)}
            </div>
          ) : null}
        </div>
      </div>

      <div className="rating">
        <div>
          <div className="card__title" style={{ marginBottom: 6 }}>
            DX Rating
          </div>
          <div className="rating__total" style={{ color: player.tier.color }}>
            {formatInt(player.rating)}
          </div>
          <div className="rating__tier" style={{ color: player.tier.color }}>
            {player.tier.label}
          </div>
        </div>

        <div className="rating__bar" role="img" aria-label="B35 与 B15 的分数占比">
          {composition.map((item) => (
            <span
              key={item.label}
              style={{ width: `${(item.value / sum) * 100}%`, background: item.color }}
              title={`${item.label} ${formatInt(item.value)}`}
            />
          ))}
        </div>

        <div className="rating__legend">
          {composition.map((item) => (
            <span key={item.label}>
              <span className="legend-dot" style={{ background: item.color }} aria-hidden />
              {item.label}
              <b style={{ marginLeft: 6 }}>{formatInt(item.value)}</b>
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

function trophyColor(color: PlayerView['trophyColor']): string {
  switch (color) {
    case 'bronze':
      return '#d08a56';
    case 'silver':
      return '#cbd5e1';
    case 'gold':
      return '#f5c542';
    case 'rainbow':
      return 'linear-gradient(90deg,#ff5f6d,#ffc371,#7ee8a2,#5bc0eb,#a06bff)';
    default:
      return '#e2e8f0';
  }
}
