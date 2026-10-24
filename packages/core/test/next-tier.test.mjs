/**
 * `nextTier`（距下一档还差多少）的测试。
 *
 * ── 这里最容易写反的一处 ────────────────────────────────────────────
 *
 * `RATING_TIERS` 是**降序**的（16000「虹極」在最前，0「灰」在最后）。
 * 「下一档」是当前档在数组里的**前一项**。
 * 写成后一项的话，会一直返回"已经是最高档" —— 而且看起来还挺合理，
 * 不写测试很难发现。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { RATING_TIERS, nextTier, ratingTier } from '../dist/index.js';

test('档位表是降序的（这是 nextTier 的前提）', () => {
  for (let i = 1; i < RATING_TIERS.length; i += 1) {
    assert.ok(
      RATING_TIERS[i].minimum < RATING_TIERS[i - 1].minimum,
      `第 ${i} 项没有比前一项低：${RATING_TIERS[i].minimum} vs ${RATING_TIERS[i - 1].minimum}`,
    );
  }
});

test('中间档位：给出正确的下一档和差距', () => {
  const info = nextTier(14872);
  assert.equal(info.current.label, '金');
  assert.ok(info.next);
  assert.equal(info.next.label, '虹');
  assert.equal(info.gap, 128);
});

test('刚好在档位线上：当前档就是这一档，差值为整段', () => {
  const info = nextTier(15000);
  assert.equal(info.current.label, '虹');
  assert.ok(info.next);
  assert.equal(info.next.label, '虹極');
  assert.equal(info.gap, 1000);
});

test('最高档：next 为 null、gap 为 0', () => {
  for (const rating of [16000, 16500, 99999]) {
    const info = nextTier(rating);
    assert.equal(info.current.label, '虹極');
    assert.equal(info.next, null, `${rating} 不该有下一档`);
    assert.equal(info.gap, 0);
  }
});

test('最低档：下一档是白', () => {
  const info = nextTier(0);
  assert.equal(info.current.label, '灰');
  assert.ok(info.next);
  assert.equal(info.next.label, '白');
  assert.equal(info.gap, 2000);
});

test('每个档位都往上走一格，不会原地踏步', () => {
  for (let i = 1; i < RATING_TIERS.length; i += 1) {
    // 取第 i 项的门槛分（它属于第 i 项这一档）
    const rating = RATING_TIERS[i].minimum;
    const info = nextTier(rating);

    assert.equal(
      info.current.label,
      RATING_TIERS[i].label,
      `${rating} 应该落在 ${RATING_TIERS[i].label}`,
    );

    if (i === 0) {
      assert.equal(info.next, null, `${rating} 是最高档`);
    } else {
      assert.ok(info.next, `${rating} 应该有下一档`);
      assert.equal(
        info.next.label,
        RATING_TIERS[i - 1].label,
        `${rating} 的下一档应该是 ${RATING_TIERS[i - 1].label}（不是 ${info.next.label}）`,
      );
      assert.equal(info.gap, RATING_TIERS[i - 1].minimum - rating);
    }
  }
});

test('ratingTier 与 nextTier 的当前档一致', () => {
  for (const rating of [0, 1999, 2000, 6999, 12000, 15999, 16000]) {
    assert.equal(nextTier(rating).current.label, ratingTier(rating).label);
  }
});

test('非法输入当 0 处理，不抛异常', () => {
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -100, null, undefined]) {
    const info = nextTier(bad);
    assert.ok(info.current, `${bad} 应该给个兜底档位`);
    assert.ok(info.gap >= 0, `${bad} 的 gap 不能是负数`);
  }
});
