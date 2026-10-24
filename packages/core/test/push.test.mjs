/**
 * 推分（反算）的测试。
 *
 * ── 这里最关键的一条 ────────────────────────────────────────────────
 *
 * 反算最容易出的错是「解出来的达成率代回去算不到目标」——
 * 因为系数是分档的常数，直接除出来的值很可能落在**别的档**里。
 *
 * 所以主测试用**二分**求出基准答案，再和反算结果对齐。
 * 手写几个用例只能覆盖想得到的边界；二分扫全表能把每一档都验到。
 *
 * ── 两个反直觉的事实（测试把它们钉住了）──────────────────────────
 *
 * 1. 达成率低于 10% 时系数是 0 —— 一分都没有。
 * 2. 每档之间是**跳变**的，所以低分**不连续**：
 *    定数 8 打 10% 给 1 分，打 20% 直接给 5 分，中间 2/3/4 分**打不出来**。
 *
 * 所以 `requiredAchievement` 返回 `undefined` 有两种含义，都是对的：
 *   · 这个定数的天花板不够
 *   · 目标分数落在跳变缝隙里
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ACHIEVEMENT_CAP,
  calculateDxRating,
  gainTable,
  improvementCandidates,
  maxRatingForLevel,
  minRatingForLevel,
  pushPlan,
  requiredAchievement,
} from '../dist/index.js';

/**
 * 用二分求真正的「最低达成率」—— 反算的基准答案。
 *
 * `calculateDxRating` 对达成率单调不减（系数分档但只升不降），所以可以二分。
 */
function trueMinimumAchievement(levelValue, target) {
  if (calculateDxRating(levelValue, ACHIEVEMENT_CAP) < target) return undefined;

  let low = 0;
  let high = ACHIEVEMENT_CAP;
  for (let i = 0; i < 60; i += 1) {
    const middle = (low + high) / 2;
    if (calculateDxRating(levelValue, middle) >= target) high = middle;
    else low = middle;
  }
  return high;
}

// ══════════════════════════════════════════════════════════════════════
// 反算：和二分基准对齐
// ══════════════════════════════════════════════════════════════════════

test('反算结果必须和二分基准一致（扫全表）', () => {
  let solved = 0;
  let gaps = 0;

  for (let level = 8; level <= 15.001; level += 0.1) {
    const levelValue = Math.round(level * 10) / 10;
    const ceiling = maxRatingForLevel(levelValue);

    for (let target = 1; target <= ceiling; target += 3) {
      const answer = requiredAchievement(levelValue, target);
      const expected = trueMinimumAchievement(levelValue, target);

      if (expected === undefined) {
        assert.equal(
          answer,
          undefined,
          `定数 ${levelValue} 目标 ${target} 应该无解，却给了 ${answer?.achievement}%`,
        );
        continue;
      }

      if (answer === undefined) {
        /*
         * 目标落在跳变缝隙里 —— 打得出的最小分已经超过目标，
         * 所以"没有恰好等于目标的解"是对的。确认它确实跳过去了。
         */
        const achieved = calculateDxRating(levelValue, Math.ceil(expected * 10000) / 10000);
        assert.ok(
          achieved > target,
          `定数 ${levelValue} 目标 ${target} 报无解，但下个档位只到 ${achieved}，应该能解`,
        );
        gaps += 1;
        continue;
      }

      const actual = calculateDxRating(levelValue, answer.achievement);
      assert.ok(
        actual >= target,
        `定数 ${levelValue} 目标 ${target}：反算 ${answer.achievement}% 只得到 ${actual}`,
      );

      // 必须是**最低**解，不能比基准高出超过一个精度步长
      assert.ok(
        answer.achievement <= expected + 0.0002,
        `定数 ${levelValue} 目标 ${target}：反算 ${answer.achievement}%，` +
          `基准最低只要 ${expected.toFixed(4)}% —— 解高了，档位选错`,
      );

      solved += 1;
    }
  }

  assert.ok(solved > 300, `只验了 ${solved} 组有解的，覆盖不够（缝隙 ${gaps} 组）`);
});

test('反算给出的达成率不会超过 100.5% 的上限', () => {
  for (let level = 8; level <= 15.001; level += 0.1) {
    const levelValue = Math.round(level * 10) / 10;
    // 天花板是按 AP+ 算的，所以这里也要按 AP 问
    const ceiling = maxRatingForLevel(levelValue);
    const answer = requiredAchievement(levelValue, ceiling, { allPerfect: true });
    assert.ok(answer, `定数 ${levelValue} 打满应该有解`);
    assert.ok(answer.achievement <= ACHIEVEMENT_CAP + 1e-9, '达成率越过了上限');
  }
});

test('目标超过天花板时返回 undefined', () => {
  const ceiling = maxRatingForLevel(12);
  assert.equal(requiredAchievement(12, ceiling + 10), undefined);
});

test('非法输入返回 undefined', () => {
  assert.equal(requiredAchievement(0, 100), undefined);
  assert.equal(requiredAchievement(-1, 100), undefined);
  assert.equal(requiredAchievement(Number.NaN, 100), undefined);
  assert.equal(requiredAchievement(13, 0), undefined);
  assert.equal(requiredAchievement(13, -5), undefined);
});

test('AP 加分会让需要的达成率更低（或持平）', () => {
  const normal = requiredAchievement(14.5, 300, { allPerfect: false });
  const ap = requiredAchievement(14.5, 300, { allPerfect: true });
  assert.ok(normal && ap);
  assert.ok(
    ap.achievement <= normal.achievement,
    `AP 反而要求更高：${ap.achievement}% > ${normal.achievement}%`,
  );
});

// ══════════════════════════════════════════════════════════════════════
// 低分不连续
// ══════════════════════════════════════════════════════════════════════

test('minRatingForLevel 等于最低非零档的 rating', () => {
  assert.equal(minRatingForLevel(8), calculateDxRating(8, 10.0));
  assert.equal(minRatingForLevel(0), 0);
  assert.ok(minRatingForLevel(14) > minRatingForLevel(10), '定数越高最低分应该越高');
});

test('系数跳变处存在「打不出的分」——但反算会给下一个档位', () => {
  /*
   * 20% 是系数从 1.6 跳到 3.2 的地方：
   *   19.9999% → floor(8 × 0.199999 × 1.6) = 2
   *   20.0000% → floor(8 × 0.2 × 3.2)      = 5
   * 所以 3、4 分**没有对应达成率**。
   *
   * 但反算的语义是「至少 target」，所以问 3 分会得到 20%（实际 5 分）——
   * 这**不是 bug**，而是推分场景下正确的行为：你要至少 3 分，那就打 20%。
   */
  const before = calculateDxRating(8, 19.9999);
  const at = calculateDxRating(8, 20.0);
  assert.ok(at - before > 1, `假设不成立：${before} → ${at}`);

  const answer = requiredAchievement(8, 3);
  assert.ok(answer, '3 分应该有解（给下一个档位）');
  assert.equal(answer.achievement, 20, '应该给 20% 这个档位起点');
  assert.ok(answer.rating >= 3, `实际给到 ${answer.rating}，应该 ≥ 3`);
});

test('目标低于最低分时仍然有解（超过目标即可）', () => {
  // 定数 12.5 打底 2 分；要 1 分就返回 10%（实际 2 分）
  const floor = minRatingForLevel(12.5);
  assert.ok(floor > 1, `假设不成立：打底是 ${floor} 分`);

  const answer = requiredAchievement(12.5, 1);
  assert.ok(answer, '低于打底分也应该有解');
  assert.equal(answer.achievement, 10, '应该给最低档的起点 10%');
  assert.ok(answer.rating >= 1);
});

// ══════════════════════════════════════════════════════════════════════
// pushPlan
// ══════════════════════════════════════════════════════════════════════

test('pushPlan：没打过时 gap 等于目标', () => {
  const plan = pushPlan(14.0, null, 300);
  assert.equal(plan.current, null);
  assert.equal(plan.gap, 300);
  assert.ok(plan.ceiling > 0);
});

test('pushPlan：已经超过目标时 gap 是负数', () => {
  const plan = pushPlan(14.0, 100.5, 250);
  assert.ok(plan.current);
  assert.ok(plan.current.rating > 250);
  assert.ok(plan.gap < 0, `gap 应该是负的，实际 ${plan.gap}`);
});

test('pushPlan：current.rating 和正算一致', () => {
  const plan = pushPlan(13.7, 98.5, 300);
  assert.ok(plan.current);
  assert.equal(plan.current.rating, calculateDxRating(13.7, 98.5));
});

// ══════════════════════════════════════════════════════════════════════
// gainTable
// ══════════════════════════════════════════════════════════════════════

test('gainTable 按达成率升序，且 rating 单调不减', () => {
  const rows = gainTable(14.0);
  assert.ok(rows.length > 0);

  for (let i = 1; i < rows.length; i += 1) {
    assert.ok(rows[i].achievement > rows[i - 1].achievement, `第 ${i} 档的达成率没有递增`);
    assert.ok(rows[i].rating >= rows[i - 1].rating, `第 ${i} 档的 rating 掉了`);
  }
});

test('gainTable 的 gain 等于相邻两档 rating 之差', () => {
  const rows = gainTable(14.0);
  for (let i = 0; i < rows.length; i += 1) {
    const previous = i === 0 ? 0 : rows[i - 1].rating;
    assert.equal(rows[i].gain, rows[i].rating - previous, `第 ${i} 档的 gain 算错了`);
  }
});

test('gainTable 对非法定数返回空数组', () => {
  assert.deepEqual(gainTable(0), []);
  assert.deepEqual(gainTable(Number.NaN), []);
});

// ══════════════════════════════════════════════════════════════════════
// improvementCandidates
// ══════════════════════════════════════════════════════════════════════

test('挑出提升空间最大的，且过滤掉已经打满的', () => {
  const entries = [
    { id: 'full', levelValue: 13.0, rating: maxRatingForLevel(13.0) },
    { id: 'big', levelValue: 14.5, rating: 200 },
    { id: 'small', levelValue: 10.0, rating: 100 },
    { id: 'bad', levelValue: 0, rating: 50 },
  ];

  const picked = improvementCandidates(entries, (entry) =>
    entry.levelValue <= 0 ? null : { levelValue: entry.levelValue, rating: entry.rating },
  );

  assert.ok(
    picked.every((item) => item.entry.id !== 'full'),
    '打满的那条不该出现在建议里',
  );
  assert.ok(
    picked.every((item) => item.entry.id !== 'bad'),
    '定数非法的条目不该出现',
  );

  for (let i = 1; i < picked.length; i += 1) {
    assert.ok(picked[i - 1].headroom >= picked[i].headroom, '没有按提升空间降序');
  }
});

test('limit 生效', () => {
  const entries = Array.from({ length: 20 }, (_, i) => ({
    id: `e${i}`,
    levelValue: 13 + i * 0.05,
    rating: 100,
  }));
  const picked = improvementCandidates(
    entries,
    (entry) => ({ levelValue: entry.levelValue, rating: entry.rating }),
    3,
  );
  assert.equal(picked.length, 3);
});
