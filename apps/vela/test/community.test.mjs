/**
 * 用户群配置的测试。
 *
 * ── 为什么这个也要测 ────────────────────────────────────────────────
 *
 * 这里最容易出的错不是「算错」，而是**配置留空时界面显示了一个空群号**。
 * 那种情况下用户点进去什么也看不到，比不显示更糟。
 *
 * 所以核心断言是：**没配群号 → `hasCommunity()` 必须为 false**，
 * 引导页那一步和设置页那一行都必须消失。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  QQ_GROUP,
  QQ_GROUP_KEY,
  groupNumber,
  groupUrl,
  hasCommunity,
  hasGroupQr,
} from '../src/common/community.js';

test('当前配置下 hasCommunity 与 QQ_GROUP 一致', () => {
  const configured = typeof QQ_GROUP === 'string' && QQ_GROUP.trim().length > 0;
  assert.equal(hasCommunity(), configured, 'hasCommunity 必须严格跟着 QQ_GROUP 走');
});

test('没配群号时 groupNumber 是空串（不是 undefined / null）', () => {
  const value = groupNumber();
  assert.equal(typeof value, 'string', '必须是字符串，模板里要直接渲染');
  if (!hasCommunity()) assert.equal(value, '', '没配就该是空串');
});

test('没配群号时不该有二维码', () => {
  if (!hasCommunity() || !QQ_GROUP_KEY.trim()) {
    assert.equal(hasGroupQr(), false);
    assert.equal(groupUrl(), '');
  }
});

test('群号不能带空白（否则复制粘贴时会搜不到）', () => {
  if (hasCommunity()) {
    assert.equal(groupNumber(), groupNumber().trim(), '群号两端不能有空白');
    assert.match(groupNumber(), /^\d+$/, '群号应当全是数字');
  }
});

test('配了 key 时生成的链接形状正确', () => {
  if (!QQ_GROUP_KEY.trim()) return;
  const url = groupUrl();
  assert.match(url, /^https:\/\/qm\.qq\.com\/cgi-bin\/qm\/qr\?k=/, '加群链接的域名和路径');
  assert.ok(url.includes(encodeURIComponent(QQ_GROUP_KEY)), 'key 要被正确编码');
  assert.equal(hasGroupQr(), true);
});

test('QQ_GROUP 是字符串类型（不要写成数字）', () => {
  // 写成数字会丢前导零，而且 hasCommunity 的类型判断会落到 false
  assert.equal(typeof QQ_GROUP, 'string', 'QQ_GROUP 必须是字符串，别写成数字');
});
