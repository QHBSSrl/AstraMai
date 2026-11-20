/**
 * 用户群配置的测试。
 *
 * ── 这里最容易出的错 ────────────────────────────────────────────────
 *
 * 不是"算错"，而是**配置留空时界面仍显示了一个空群号**——
 * 那种情况下用户点进去什么也看不到，比不显示更糟。
 *
 * 所以核心断言是：没配群号 → `hasCommunity()` 必须为 false，
 * 引导页那一步和设置页那一行都必须消失。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  QQ_GROUP,
  QQ_GROUP_URL,
  groupNumber,
  groupUrl,
  hasCommunity,
  hasGroupQr,
} from '../src/common/community.js';

test('hasCommunity 与 QQ_GROUP 一致', () => {
  const configured = typeof QQ_GROUP === 'string' && QQ_GROUP.trim().length > 0;
  assert.equal(hasCommunity(), configured, 'hasCommunity 必须严格跟着 QQ_GROUP 走');
});

test('没配群号时 groupNumber 是空串（不是 undefined / null）', () => {
  const value = groupNumber();
  assert.equal(typeof value, 'string', '必须是字符串，模板里要直接渲染');
  if (!hasCommunity()) assert.equal(value, '');
});

test('没配群号时不该有二维码', () => {
  if (!hasCommunity()) {
    assert.equal(hasGroupQr(), false);
    assert.equal(groupUrl(), '');
  }
});

test('QQ_GROUP 是字符串类型（不要写成数字）', () => {
  // 写成数字会丢前导零，而且 hasCommunity 的类型判断会落到 false
  assert.equal(typeof QQ_GROUP, 'string', 'QQ_GROUP 必须是字符串，别写成数字');
});

test('群号去掉空白后全是数字', () => {
  if (!hasCommunity()) return;
  assert.equal(groupNumber(), groupNumber().trim(), '群号两端不能有空白');
  assert.match(groupNumber(), /^\d+$/, '群号应当全是数字');
});

test('配了链接时 groupUrl 直接返回它', () => {
  if (!hasCommunity() || !QQ_GROUP_URL.trim()) return;
  assert.equal(groupUrl(), QQ_GROUP_URL.trim());
  assert.equal(hasGroupQr(), true);
  assert.match(groupUrl(), /^https:\/\//, '二维码里必须是 https 链接');
});

test('链接长度不要失控（二维码太密就扫不出来）', () => {
  if (!hasGroupQr()) return;
  const length = groupUrl().length;
  assert.ok(
    length <= 600,
    `群链接有 ${length} 字符，二维码会密到扫不出来。` +
      '考虑换成短链 https://qm.qq.com/cgi-bin/qm/qr?k=<authKey>',
  );
});
