/**
 * osu! 用户名的输入校验测试。
 *
 * ── 为什么单独测 ────────────────────────────────────────────────────
 *
 * 这个 kind 是**第一个非数字的输入**，而原来的输入管线
 * （`normalizeDigits` / `appendDigit` / `backspace`）全是按数字写的。
 * 一个没改到的地方就会把字母抹掉，症状是「怎么输都输不进去」。
 *
 * 实测过的真实用户名形态：`mrekk`、`Cookiezi`、`Rafis`、
 * `_index`、`[ Z l a t a n ]`（带方括号和空格的确实存在）。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  KIND_LABELS,
  KIND_SHORT_LABELS,
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
  appendDigit,
  backspace,
  describeInput,
  isReadyToSubmit,
  isUsername,
  maxLengthOf,
  normalizeByKind,
  normalizeUsername,
  summarizeTarget,
} from '../src/common/validate.js';

// ══════════════════════════════════════════════════════════════════════
// 归一化
// ══════════════════════════════════════════════════════════════════════

test('用户名保留字母、数字、下划线、连字符、空格、方括号', () => {
  assert.equal(normalizeUsername('mrekk'), 'mrekk');
  assert.equal(normalizeUsername('Cookiezi'), 'Cookiezi');
  assert.equal(normalizeUsername('_index-01'), '_index-01');
  assert.equal(normalizeUsername('[ Z l a t a n ]'), '[ Z l a t a n ]');
});

test('用户名过滤掉不允许的字符（含中文）', () => {
  assert.equal(normalizeUsername('零度'), '', '中文不是合法用户名');
  assert.equal(normalizeUsername('mrekk!'), 'mrekk');
  assert.equal(normalizeUsername('a@b'), 'ab');
  assert.equal(normalizeUsername('a/b'), 'ab');
});

test('normalizeByKind 按 kind 走，不会把用户名抹成空', () => {
  // 这就是最关键的一条：用 normalizeDigits 处理 'mrekk' 会得到空串
  assert.equal(normalizeByKind('username', 'mrekk'), 'mrekk');
  assert.equal(normalizeByKind('friendCode', '123456789012345'), '123456789012345');
  assert.equal(normalizeByKind('qq', '12345'), '12345');
  // 反向确认：数字 kind 仍然会过滤字母
  assert.equal(normalizeByKind('friendCode', 'abc123'), '123');
});

// ══════════════════════════════════════════════════════════════════════
// 校验
// ══════════════════════════════════════════════════════════════════════

test('合法用户名', () => {
  assert.equal(isUsername('mrekk'), true);
  assert.equal(isUsername('ab'), true, '2 个字符是下限');
  assert.equal(isUsername('a'.repeat(USERNAME_MAX_LENGTH)), true, '15 个字符是上限');
});

test('非法用户名', () => {
  assert.equal(isUsername(''), false);
  assert.equal(isUsername('a'), false, '1 个字符太短');
  assert.equal(isUsername('a'.repeat(USERNAME_MAX_LENGTH + 1)), false, '超长');
  assert.equal(isUsername('零度'), false, '中文');
  assert.equal(isUsername('a!b'), false, '含非法字符');
});

test('isReadyToSubmit 按 kind 分派', () => {
  assert.equal(isReadyToSubmit('username', 'mrekk'), true);
  assert.equal(isReadyToSubmit('username', 'a'), false);
  assert.equal(isReadyToSubmit('friendCode', '123456789012345'), true);
  assert.equal(isReadyToSubmit('qq', '12345'), true);
});

test('maxLengthOf', () => {
  assert.equal(maxLengthOf('username'), USERNAME_MAX_LENGTH);
  assert.equal(maxLengthOf('qq'), 11);
  assert.equal(maxLengthOf('friendCode'), 20);
});

// ══════════════════════════════════════════════════════════════════════
// 键盘输入
// ══════════════════════════════════════════════════════════════════════

test('appendDigit 对用户名追加字母', () => {
  let value = '';
  for (const ch of 'mrekk') value = appendDigit('username', value, ch);
  assert.equal(value, 'mrekk');
});

test('appendDigit 对数字 kind 仍然只收数字', () => {
  assert.equal(appendDigit('friendCode', '123', 'a'), '123', '字母被丢掉');
  assert.equal(appendDigit('friendCode', '123', '4'), '1234');
});

test('appendDigit 超过上限时原样返回，不截断', () => {
  const full = 'a'.repeat(USERNAME_MAX_LENGTH);
  assert.equal(appendDigit('username', full, 'b'), full, '超长就不加，而不是截断');
});

test('backspace 对用户名删的是字符不是数字', () => {
  assert.equal(backspace('mrekk'), 'mrek');
  assert.equal(backspace('m'), '');
  assert.equal(backspace(''), '');
  // 关键：不能把字母先抹掉再删
  assert.equal(backspace('abc'), 'ab');
});

// ══════════════════════════════════════════════════════════════════════
// 提示文案
// ══════════════════════════════════════════════════════════════════════

test('describeInput 对用户名给出字符数而不是位数', () => {
  const idle = describeInput('username', '');
  assert.equal(idle.state, 'idle');
  assert.match(idle.text, /用户名/);

  /*
   * ⚠️ `mre` 是**已经合法**的用户名（3 个字符在 2–15 内），
   * 所以它是 `ready` 而不是 `partial`。第一版这里写错了——
   * 把「短」和「不合法」混成一回事。
   *
   * 真正的 partial 是**不足下限**：1 个字符。
   */
  const partial = describeInput('username', 'm');
  assert.equal(partial.state, 'partial');
  assert.match(partial.text, /字符/, '用户名用「字符」不是「位」');

  const shortEnough = describeInput('username', 'mre');
  assert.equal(shortEnough.state, 'ready', '3 个字符已经可以提交了');

  const ready = describeInput('username', 'mrekk');
  assert.equal(ready.state, 'ready');
  assert.match(ready.text, /已就绪/);
});

test('describeInput 对数字 kind 不变', () => {
  assert.equal(describeInput('qq', '').state, 'idle');
  assert.equal(describeInput('qq', '12345').state, 'ready');
  assert.match(describeInput('qq', '123').text, /位/);
});

test('summarizeTarget 的标签按 kind 变', () => {
  assert.equal(summarizeTarget('username', 'mrekk'), 'osu! mrekk');
  assert.equal(summarizeTarget('friendCode', '123456789012345'), '好友码 123456789012345');
  assert.equal(summarizeTarget('qq', '12345'), 'QQ 12345');
  assert.equal(summarizeTarget('username', ''), null);
});

test('KIND_LABELS 覆盖所有 kind', () => {
  for (const kind of ['friendCode', 'qq', 'username']) {
    assert.equal(typeof KIND_LABELS[kind], 'string', `${kind} 缺 KIND_LABELS`);
    assert.equal(typeof KIND_SHORT_LABELS[kind], 'string', `${kind} 缺 KIND_SHORT_LABELS`);
  }
  assert.equal(KIND_LABELS.username, '用户名');
});

test('长度常量合理', () => {
  assert.ok(USERNAME_MIN_LENGTH >= 2);
  assert.ok(USERNAME_MAX_LENGTH > USERNAME_MIN_LENGTH);
});
