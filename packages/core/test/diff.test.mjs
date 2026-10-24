/**
 * 成绩对比（两次 B50 的 diff）的测试。
 *
 * ── 这里最容易搞错的一条 ────────────────────────────────────────────
 *
 * B50 会**换血**：这周在榜上的谱，下周可能被别的挤出去。
 * 所以「掉出」和「跌了」**是两件不同的事**，混在一起会让用户
 * 以为自己的成绩丢了 —— 其实只是被更好的谱挤出前 50 了。
 *
 * 测试专门把这两类分开验。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { diffB50, summarizeDiff } from '../dist/index.js';

/** 造一条最小可用的 B50Entry（只保留对比用到的字段）。 */
function entry(overrides) {
  return {
    songId: 1,
    title: '曲名',
    difficultyShort: 'MASTER',
    difficultyColor: '#f00',
    levelValue: 14.0,
    type: 'dx',
    levelIndex: 3,
    achievements: 100.0,
    rating: 300,
    ...overrides,
  };
}

/** 造一份最小可用的 B50View。 */
function view(rating, standard = [], dx = []) {
  return {
    player: { rating },
    standard,
    dx,
    standardSelections: [],
    dxSelections: [],
    stats: {},
    selfCheck: {},
    warnings: [],
    generatedAt: '',
  };
}

// ══════════════════════════════════════════════════════════════════════
// 基本
// ══════════════════════════════════════════════════════════════════════

test('没有上次数据时 comparable 为 false', () => {
  const diff = diffB50(null, view(15000, [entry({})]));
  assert.equal(diff.comparable, false);
  assert.equal(diff.ratingDelta, 0);
  assert.equal(diff.nextRating, 15000);
  assert.equal(summarizeDiff(diff), null, '不可比较时不该给出总结');
});

test('总 Rating 变化算得对', () => {
  const diff = diffB50(view(14900), view(15012));
  assert.equal(diff.previousRating, 14900);
  assert.equal(diff.nextRating, 15012);
  assert.equal(diff.ratingDelta, 112);
});

// ══════════════════════════════════════════════════════════════════════
// 涨 / 跌 / 新进 / 掉出
// ══════════════════════════════════════════════════════════════════════

test('同一张谱分变高 → 进 gained', () => {
  const before = view(100, [entry({ songId: 10, rating: 300 })]);
  const after = view(110, [entry({ songId: 10, rating: 310 })]);
  const diff = diffB50(before, after);

  assert.equal(diff.gained.length, 1);
  assert.equal(diff.gained[0].deltaRating, 10);
  assert.equal(diff.gained[0].previous.rating, 300);
  assert.equal(diff.gained[0].next.rating, 310);
});

test('同一张谱分变低 → 进 lost', () => {
  const before = view(100, [entry({ songId: 10, rating: 310 })]);
  const after = view(100, [entry({ songId: 10, rating: 300 })]);
  const diff = diffB50(before, after);

  assert.equal(diff.lost.length, 1);
  assert.equal(diff.lost[0].deltaRating, -10);
});

test('这次才有的谱 → 进 entered（不是 gained）', () => {
  const before = view(100, []);
  const after = view(100, [entry({ songId: 20, rating: 290 })]);
  const diff = diffB50(before, after);

  assert.equal(diff.entered.length, 1);
  assert.equal(diff.gained.length, 0, '新进的不能算"涨了"');
  assert.equal(diff.entered[0].previous, null);
});

test('上次有这次没有 → 进 left（不是 lost）', () => {
  const before = view(100, [entry({ songId: 30, rating: 280 })]);
  const after = view(100, []);
  const diff = diffB50(before, after);

  assert.equal(diff.left.length, 1);
  assert.equal(diff.lost.length, 0, '掉出 B50 不能算"跌了"');
  assert.equal(diff.left[0].next, null);
});

test('分没变 → unchanged，且不算涨也不算跌', () => {
  const before = view(100, [entry({ songId: 40, rating: 300 })]);
  // 达成率变了但 rating 没变（落档未跨）
  const after = view(100, [entry({ songId: 40, rating: 300, achievements: 100.4 })]);
  const diff = diffB50(before, after);

  assert.equal(diff.unchanged, 1);
  assert.equal(diff.gained.length, 0);
  assert.equal(diff.lost.length, 0);
});

// ══════════════════════════════════════════════════════════════════════
// 匹配
// ══════════════════════════════════════════════════════════════════════

test('同曲不同难度算两条（levelIndex 不同）', () => {
  const before = view(100, [
    entry({ songId: 50, levelIndex: 2, rating: 280 }),
    entry({ songId: 50, levelIndex: 3, rating: 300 }),
  ]);
  const after = view(100, [
    entry({ songId: 50, levelIndex: 3, rating: 310 }),
  ]);
  const diff = diffB50(before, after);

  assert.equal(diff.gained.length, 1, 'MASTER 涨了');
  assert.equal(diff.gained[0].next.rating, 310);
  assert.equal(diff.left.length, 1, 'EXPERT 掉出');
  assert.equal(diff.left[0].previous.rating, 280);
});

test('同曲同难度但 type 不同（标准 / DX）算两条', () => {
  const before = view(100, [entry({ songId: 60, type: 'standard', rating: 250 })]);
  const after = view(100, [entry({ songId: 60, type: 'dx', rating: 320 })]);
  const diff = diffB50(before, after);

  assert.equal(diff.entered.length, 1);
  assert.equal(diff.left.length, 1);
});

test('缺 songId 时退回用曲名匹配（兼容旧缓存）', () => {
  const before = view(100, [entry({ songId: 0, title: '某首歌', rating: 300 })]);
  const after = view(100, [entry({ songId: 0, title: '某首歌', rating: 305 })]);
  const diff = diffB50(before, after);

  assert.equal(diff.gained.length, 1);
  assert.equal(diff.gained[0].deltaRating, 5);
});

test('B35 和 B15 两组都会参与对比', () => {
  const before = view(100, [entry({ songId: 70, type: 'standard', rating: 300 })], []);
  const after = view(100, [], [entry({ songId: 70, type: 'standard', rating: 310 })]);
  const diff = diffB50(before, after);

  assert.equal(diff.gained.length, 1, '从 B35 挪到 B15 应该按同一张谱比');
});

// ══════════════════════════════════════════════════════════════════════
// 排序
// ══════════════════════════════════════════════════════════════════════

test('gained 按涨幅降序，lost 按跌幅降序', () => {
  const before = view(100, [
    entry({ songId: 1, rating: 300 }),
    entry({ songId: 2, rating: 300 }),
    entry({ songId: 3, rating: 300 }),
  ]);
  const after = view(100, [
    entry({ songId: 1, rating: 305 }),
    entry({ songId: 2, rating: 320 }),
    entry({ songId: 3, rating: 290 }),
  ]);
  const diff = diffB50(before, after);

  assert.deepEqual(
    diff.gained.map((item) => item.deltaRating),
    [20, 5],
  );
  assert.deepEqual(
    diff.lost.map((item) => item.deltaRating),
    [-10],
  );
});

// ══════════════════════════════════════════════════════════════════════
// 总结
// ══════════════════════════════════════════════════════════════════════

test('总结把四种变化都写出来', () => {
  const before = view(100, [
    entry({ songId: 1, rating: 300 }),
    entry({ songId: 2, rating: 300 }),
    entry({ songId: 3, rating: 300 }),
  ]);
  const after = view(112, [
    entry({ songId: 1, rating: 310 }),
    entry({ songId: 2, rating: 290 }),
    entry({ songId: 4, rating: 280 }),
  ]);
  const text = summarizeDiff(diffB50(before, after));

  assert.ok(text.includes('+12'), `总 Rating 变化没写出来：${text}`);
  assert.ok(text.includes('1 首涨'), `涨的条数没写出来：${text}`);
  assert.ok(text.includes('1 首跌'), `跌的条数没写出来：${text}`);
  assert.ok(text.includes('1 首新进'), `新进条数没写出来：${text}`);
});

test('完全没变化时返回 null（不显示"持平"这种废话）', () => {
  const same = [entry({ songId: 1, rating: 300 })];
  const diff = diffB50(view(100, same), view(100, same));
  assert.equal(summarizeDiff(diff), null);
});

test('只有 Rating 变了也能总结', () => {
  const same = [entry({ songId: 1, rating: 300 })];
  const diff = diffB50(view(100, same), view(105, same));
  const text = summarizeDiff(diff);
  assert.ok(text && text.includes('+5'), `应该只写总 Rating：${text}`);
});
