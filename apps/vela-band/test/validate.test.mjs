/**
 * 输入校验的单元测试。
 *
 * 手表上没有系统输入法，所有输入都来自端上的自绘键盘，
 * 「什么时候算输完了、能不能提交」这套规则必须被测住——
 * 它在键盘和查询之间，出错的症状是「按钮按不动」或者「提交了不合法的值」。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FRIEND_CODE_LENGTH,
  FRIEND_CODE_MAX_LENGTH,
  FRIEND_CODE_MIN_LENGTH,
  QQ_MAX_LENGTH,
  QQ_MIN_LENGTH,
  appendDigit,
  backspace,
  describeInput,
  isFriendCode,
  isQq,
  isReadyToSubmit,
  maxLengthOf,
  normalizeDigits,
  summarizeTarget,
} from '../src/common/validate.js';

test('normalizeDigits 只保留数字', () => {
  assert.equal(normalizeDigits('12a3'), '123');
  assert.equal(normalizeDigits('  1 2 3  '), '123');
  assert.equal(normalizeDigits('abc'), '');
  assert.equal(normalizeDigits(null), '');
  assert.equal(normalizeDigits(undefined), '');
  assert.equal(normalizeDigits('１２３'), ''); // 全角数字不认
});

test('好友码长度是区间，不写死 15 位', () => {
  // 舞萌好友码是 15 位，这个常量保留着给 UI 提示用；
  // 但**校验本身是区间**——中二的好友码长度我没实测过，
  // 写死 15 会把中二整个挡在门外。
  assert.equal(FRIEND_CODE_LENGTH, 15);
  assert.equal(FRIEND_CODE_MIN_LENGTH, 10);
  assert.equal(FRIEND_CODE_MAX_LENGTH, 20);

  assert.equal(isFriendCode('1'.repeat(15)), true, '舞萌的 15 位必须通过');
  assert.equal(isFriendCode('1'.repeat(FRIEND_CODE_MIN_LENGTH)), true);
  assert.equal(isFriendCode('1'.repeat(FRIEND_CODE_MAX_LENGTH)), true);

  // 区间外仍然拒绝——完全不管长度就等于把校验去掉了
  assert.equal(isFriendCode('1'.repeat(FRIEND_CODE_MIN_LENGTH - 1)), false);
  assert.equal(isFriendCode('1'.repeat(FRIEND_CODE_MAX_LENGTH + 1)), false);
  // ⚠️ 这是放宽带来的**已知代价**：14 位（少输一位的舞萌码）现在会通过客户端校验，
  // 要到服务端才被拒。换取的是「中二不会因为长度不同被客户端整个挡住」。
  assert.equal(isFriendCode('1'.repeat(14)), true, '区间内的长度一律放行，由服务端做权威校验');
  assert.equal(isFriendCode(''), false);
  assert.equal(isFriendCode('abc'), false);
});

test('QQ 号为 5–11 位', () => {
  assert.equal(isQq('1'.repeat(QQ_MIN_LENGTH - 1)), false);
  assert.equal(isQq('1'.repeat(QQ_MIN_LENGTH)), true);
  assert.equal(isQq('1'.repeat(QQ_MAX_LENGTH)), true);
  assert.equal(isQq('1'.repeat(QQ_MAX_LENGTH + 1)), false);
});

test('长度上限随查询方式变化', () => {
  assert.equal(maxLengthOf('friendCode'), FRIEND_CODE_MAX_LENGTH);
  assert.equal(maxLengthOf('friendCode'), 20);
  assert.equal(maxLengthOf('qq'), 11);
});

test('appendDigit 超过上限时原样返回，不做静默截断', () => {
  let value = '';
  for (let i = 0; i < FRIEND_CODE_MAX_LENGTH; i += 1) value = appendDigit('friendCode', value, '1');
  assert.equal(value.length, FRIEND_CODE_MAX_LENGTH);
  // 再输一位应当被忽略，而不是把长度截回去（那样用户会以为数字进去了）
  assert.equal(appendDigit('friendCode', value, '9'), value);

  // 「00」这类多字符输入也走同一条规则
  assert.equal(appendDigit('qq', '1234567890', '00'), '1234567890');
  assert.equal(appendDigit('qq', '12345678', '00'), '1234567800');
});

test('appendDigit 过滤非数字字符', () => {
  assert.equal(appendDigit('qq', '12', 'a'), '12');
  assert.equal(appendDigit('qq', '12', '3'), '123');
});

test('backspace 删除最后一位，空串不报错', () => {
  assert.equal(backspace('123'), '12');
  assert.equal(backspace('1'), '');
  assert.equal(backspace(''), '');
});

test('describeInput 的四种状态', () => {
  assert.equal(describeInput('friendCode', '').state, 'idle');
  // 放宽成区间后，10 位就算就绪——所以 '123'（3 位）仍是 partial
  assert.equal(describeInput('friendCode', '123').state, 'partial');
  assert.equal(describeInput('friendCode', '1'.repeat(10)).state, 'ready');
  assert.equal(describeInput('friendCode', '1'.repeat(15)).state, 'ready');
  assert.equal(describeInput('friendCode', '1'.repeat(15)).text, '好友码已就绪，15 位');

  // QQ 11 位合法
  assert.equal(describeInput('qq', '1'.repeat(11)).state, 'ready');
  // 好友码 9 位（不足下界）→ partial
  assert.equal(describeInput('friendCode', '1'.repeat(9)).state, 'partial');
});

test('describeInput 在填满但仍不合法时给出 invalid', () => {
  // 造一个「已到长度上限但不满足规则」的场景：QQ 上限 11，但这里用一个不可能的组合
  const described = describeInput('qq', '1'.repeat(12));
  assert.equal(described.state, 'invalid');
  assert.match(described.text, /5–11/);
});

test('isReadyToSubmit 与 isXxx 保持一致', () => {
  for (const value of ['', '1', '123456789', '1'.repeat(11), '1'.repeat(15)]) {
    assert.equal(isReadyToSubmit('friendCode', value), isFriendCode(value));
    assert.equal(isReadyToSubmit('qq', value), isQq(value));
  }
});

test('summarizeTarget 用于首页展示', () => {
  assert.equal(summarizeTarget('friendCode', '165423445743903'), '好友码 165423445743903');
  assert.equal(summarizeTarget('qq', '3687236844'), 'QQ 3687236844');
  assert.equal(summarizeTarget('friendCode', ''), null);
  assert.equal(summarizeTarget('qq', 'abc'), null);
});
