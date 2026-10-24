import { useMemo, useState } from 'react';

import type { B50Entry } from '@astramai/core';
import {
  formatAchievement,
  formatFixed,
  formatInt,
  gainTable,
  improvementCandidates,
  maxRatingForLevel,
  minRatingForLevel,
  pushPlan,
  requiredAchievement,
} from '@astramai/core';

interface PushPlannerProps {
  /** 已经查到的 B50，用来算「练哪条收益最大」。没查过就传 null。 */
  entries?: readonly B50Entry[] | null;
}

/** 把字符串解析成数字，空串/非法都返回 null。 */
function parseNumber(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

/**
 * 推分计算器：**从「我想要多少分」反算「我得打多少」**。
 *
 * 这是 `rating.ts` 的反方向。正算是 `定数 + 达成率 → rating`，
 * 而玩家真正会问的是：
 *
 *   「这条从 283 提到 290，要打到多少？」
 *   「这个定数最多能给我多少？值不值得练？」
 *   「再冲 0.5% 能多几分？」
 */
export function PushPlanner({ entries }: PushPlannerProps) {
  const [levelText, setLevelText] = useState('14.0');
  const [achievementText, setAchievementText] = useState('');
  const [targetText, setTargetText] = useState('300');

  const levelValue = parseNumber(levelText);
  const achievement = parseNumber(achievementText);
  const target = parseNumber(targetText);

  const plan = useMemo(() => {
    if (levelValue === null || target === null) return null;
    if (levelValue <= 0 || target <= 0) return null;
    return pushPlan(levelValue, achievement, target);
  }, [levelValue, achievement, target]);

  const gains = useMemo(() => {
    if (levelValue === null || levelValue <= 0) return [];
    return gainTable(levelValue);
  }, [levelValue]);

  const suggestions = useMemo(() => {
    if (!entries || entries.length === 0) return [];
    return improvementCandidates(
      entries,
      (entry) => {
        /*
         * 两个字段都可能是 null：
         *   `levelValue` 在曲库查不到时为空
         *   `rating`    在成绩缺 rating 时为空
         * 任缺其一就算不了提升空间，直接跳过 —— 不要用 0 兜底，
         * 那会算出"提升空间巨大"的假建议。
         */
        if (entry.levelValue === null || entry.levelValue <= 0) return null;
        if (entry.rating === null || entry.rating <= 0) return null;
        return { levelValue: entry.levelValue, rating: entry.rating };
      },
      5,
    );
  }, [entries]);

  const ceiling = levelValue !== null && levelValue > 0 ? maxRatingForLevel(levelValue) : 0;
  const floor = levelValue !== null && levelValue > 0 ? minRatingForLevel(levelValue) : 0;

  return (
    <div className="push">
      <section className="card">
        <h3 className="card__title">推分计算器</h3>
        <p className="push__hint">
          给定谱面定数和目标单曲 Rating，算出<strong>需要打到多少达成率</strong>。
          反过来也成立：填了当前达成率就能看到还差几分。
        </p>

        <div className="push__inputs">
          <label className="push__field">
            <span className="push__label">谱面定数</span>
            <input
              className="push__input"
              inputMode="decimal"
              value={levelText}
              onChange={(event) => setLevelText(event.target.value)}
              placeholder="14.0"
            />
          </label>

          <label className="push__field">
            <span className="push__label">当前达成率（可空）</span>
            <input
              className="push__input"
              inputMode="decimal"
              value={achievementText}
              onChange={(event) => setAchievementText(event.target.value)}
              placeholder="98.5"
            />
          </label>

          <label className="push__field">
            <span className="push__label">目标单曲 Rating</span>
            <input
              className="push__input"
              inputMode="numeric"
              value={targetText}
              onChange={(event) => setTargetText(event.target.value)}
              placeholder="300"
            />
          </label>
        </div>

        {plan ? (
          <div className="stats__grid push__result">
            <div className="stat">
              <div className="stat__label">当前</div>
              <div className="stat__value">
                {plan.current ? formatInt(plan.current.rating) : '—'}
              </div>
              <div className="stat__sub">
                {plan.current ? formatAchievement(plan.current.achievement) : '还没打过'}
              </div>
            </div>

            <div className="stat">
              <div className="stat__label">目标</div>
              <div className="stat__value">{formatInt(plan.target)}</div>
              <div className="stat__sub">
                {plan.gap > 0 ? `还差 ${formatInt(plan.gap)}` : '已达成'}
              </div>
            </div>

            <div className="stat">
              <div className="stat__label">需要打到</div>
              <div
                className="stat__value"
                style={{ color: plan.required ? '#f7d34e' : '#fecaca' }}
              >
                {plan.required ? `${formatFixed(plan.required.achievement, 4)}%` : '打不到'}
              </div>
              <div className="stat__sub">
                {plan.required
                  ? `${plan.required.note ?? '—'} · 届时 ${formatInt(plan.required.rating)}`
                  : `这个定数最高 ${formatInt(plan.ceiling)}`}
              </div>
            </div>

            <div className="stat">
              <div className="stat__label">这个定数的范围</div>
              <div className="stat__value">
                {formatInt(floor)} – {formatInt(ceiling)}
              </div>
              <div className="stat__sub">打底 – AP+ 满分</div>
            </div>
          </div>
        ) : (
          <p className="push__hint push__hint--warn">
            定数和目标都要填正数。定数形如 <code>14.0</code>，目标形如 <code>300</code>。
          </p>
        )}
      </section>

      {gains.length > 0 ? (
        <section className="card">
          <h3 className="card__title">档位收益</h3>
          <p className="push__hint">
            每个评级档的最低达成率，以及<strong>相比上一档多拿几分</strong>。
            冲分时先看这张表 —— 有时候再冲 0.5% 只多 2 分，不如换一首。
          </p>
          <div className="push__gains">
            {gains.map((row) => (
              <div className="push__gain" key={row.achievement}>
                <span className="push__gain-note">{row.note ?? '—'}</span>
                <span className="push__gain-ach">{formatFixed(row.achievement, 4)}%</span>
                <span className="push__gain-rating">{formatInt(row.rating)}</span>
                <span
                  className="push__gain-delta"
                  style={{ color: row.gain > 0 ? '#a7f3d0' : 'var(--text-dim, #8b9bb4)' }}
                >
                  {row.gain > 0 ? `+${row.gain}` : '—'}
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {suggestions.length > 0 ? (
        <section className="card">
          <h3 className="card__title">练哪条收益最大</h3>
          <p className="push__hint">
            从你这份 B50 里按<strong>离天花板还差多少</strong>排序。
            差值大 = 还没打到位，而且定数高，练一下最划算。
          </p>
          <div className="push__gains">
            {suggestions.map((item, index) => (
              <div className="push__gain" key={index}>
                <span className="push__gain-note">{item.entry.title}</span>
                <span className="push__gain-ach">
                  定数 {formatFixed(item.entry.levelValue, 1)}
                </span>
                <span className="push__gain-rating">{formatInt(item.current)}</span>
                <span className="push__gain-delta" style={{ color: '#f7d34e' }}>
                  可提升 {formatInt(item.headroom)}
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/*
        说明区。
        这里要把两个**反直觉但正确**的行为讲清楚，否则用户会以为算错了：
          1. 要 1 分而打底 2 分时，答案给最低档（实际超过目标）—— 语义是「至少」
          2. 某些分没有对应达成率（系数跳变处），但会给下一个档位，不是无解
      */}
      <section className="card">
        <h3 className="card__title">怎么读这个结果</h3>
        <ul className="push__notes">
          <li>
            <strong>「需要打到」是「至少这么多」</strong>：填 1 分而这首打底 2 分时，
            会给最低档（10%），实际拿 2 分 —— 这是对的，你要的是≥1。
          </li>
          <li>
            <strong>有些分打不出来</strong>：达成率跨档时系数会跳（比如 20% 那一档），
            所以 3、4 分可能没有恰好对应的达成率，会给下一个档位。
          </li>
          <li>
            <strong>只有超过天花板才算「打不到」</strong>：天花板是 AP+ 满分，
            定数决定上限。
          </li>
        </ul>
      </section>
    </div>
  );
}
