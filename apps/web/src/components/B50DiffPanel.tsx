import type { B50Diff, DiffEntry } from '@astramai/core';
import { formatFixed, formatInt } from '@astramai/core';

interface B50DiffPanelProps {
  diff: B50Diff;
}

/**
 * 成绩对比面板（web）。
 *
 * 和手表端的「对比详情」页是同一份数据、同一套分类，
 * 只是这边有横向空间，可以并排显示曲名和差值。
 *
 * ── 四类为什么要分开 ────────────────────────────────────────────────
 *
 * 「掉出 B50」和「跌了」是两件事：前者是被别的谱挤出去了，
 * 成绩可能一点没变。混在一起列，用户会以为自己成绩丢了。
 */
export function B50DiffPanel({ diff }: B50DiffPanelProps) {
  // 第一次查询、或者上一次的数据坏了 —— 没什么可比
  if (!diff.comparable) return null;

  const nothingChanged =
    diff.gained.length === 0 &&
    diff.lost.length === 0 &&
    diff.entered.length === 0 &&
    diff.left.length === 0 &&
    diff.ratingDelta === 0;

  if (nothingChanged) return null;

  const sign = diff.ratingDelta > 0 ? '+' : '';

  return (
    <section className="card diffcard">
      <div className="diffcard__head">
        <h3 className="card__title" style={{ margin: 0 }}>
          和上次比
        </h3>
        <div
          className="diffcard__total"
          style={{ color: diff.ratingDelta >= 0 ? 'var(--good)' : 'var(--bad)' }}
        >
          {sign}
          {formatInt(diff.ratingDelta)}
        </div>
      </div>

      <p className="diffcard__hint">
        上次 {formatInt(diff.previousRating)} → 这次 {formatInt(diff.nextRating)}
      </p>

      <div className="diffcard__cols">
        <Section title="涨了" tone="good" items={diff.gained} kind="delta" />
        <Section title="跌了" tone="bad" items={diff.lost} kind="delta" />
        <Section title="新进" tone="good" items={diff.entered} kind="enter" />
        {/* 掉出用中性色：它不代表退步，只是被挤出去了 */}
        <Section title="掉出" tone="dim" items={diff.left} kind="leave" />
      </div>
    </section>
  );
}

function Section({
  title,
  tone,
  items,
  kind,
}: {
  title: string;
  tone: 'good' | 'bad' | 'dim';
  items: DiffEntry[];
  kind: 'delta' | 'enter' | 'leave';
}) {
  // 空的分区不渲染 —— 四个空块比什么都不显示更糟
  if (items.length === 0) return null;

  const color = tone === 'good' ? 'var(--good)' : tone === 'bad' ? 'var(--bad)' : 'var(--text-def)';

  return (
    <div className="diffcol">
      <div className="diffcol__title">
        {title}
        <span className="diffcol__count">{items.length}</span>
      </div>
      <ul className="diffcol__list">
        {items.slice(0, 8).map((item) => (
          <li className="diffrow" key={item.key}>
            <span className="diffrow__title" title={item.title}>
              {item.title}
            </span>
            <span className="diffrow__level">
              {item.difficultyShort}
              {item.levelValue !== null ? ` ${formatFixed(item.levelValue, 1)}` : ''}
            </span>
            <span className="diffrow__value" style={{ color }}>
              {formatValue(item, kind)}
            </span>
          </li>
        ))}
      </ul>
      {items.length > 8 ? (
        <div className="diffcol__more">还有 {items.length - 8} 首…</div>
      ) : null}
    </div>
  );
}

/**
 * 每类显示什么数字。
 *
 * 新进显示"这次拿到的分"，掉出显示"原来的分" ——
 * **都不是差值**，掉出尤其不能显示负数（成绩没变，只是不在榜上）。
 */
function formatValue(item: DiffEntry, kind: 'delta' | 'enter' | 'leave'): string {
  if (kind === 'enter') return `+${formatInt(item.next?.rating ?? 0)}`;
  if (kind === 'leave') return `${formatInt(item.previous?.rating ?? 0)}`;
  return `${item.deltaRating > 0 ? '+' : ''}${formatInt(item.deltaRating)}`;
}
