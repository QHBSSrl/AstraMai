/**
 * 引导内容（协议）的结构测试。
 *
 * ── 为什么内容也要测 ────────────────────────────────────────────────
 *
 * 协议最容易被"后来改文案"改坏，而且坏了是**静默的**：
 * 某条忘了写 body → 屏幕上只剩一个标题。
 *
 * 所以断言的是**结构完整性**，不是具体文案（文案会改，结构不该变）。
 *
 * 教程那部分已删除——用户反馈教程页不要了，
 * 改成"如遇问题欢迎加入交流群"。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { TERMS_FOOTNOTE, TERMS_KEY, TERMS_POINTS, TERMS_VERSION } from '../src/common/legal.js';
import { QQ_GROUP, QQ_GROUP_URL, groupNumber, groupUrl, hasCommunity } from '../src/common/community.js';

// ══════════════════════════════════════════════════════════════════════
// 用户协议
// ══════════════════════════════════════════════════════════════════════

test('协议有版本号，且是 ISO 日期格式', () => {
  assert.equal(typeof TERMS_VERSION, 'string');
  assert.match(TERMS_VERSION, /^\d{4}-\d{2}-\d{2}$/, '版本号用日期，方便排序和判断新旧');
});

test('协议有要点，每条都有标题和正文', () => {
  assert.ok(Array.isArray(TERMS_POINTS));
  assert.ok(TERMS_POINTS.length > 0, '协议不能是空的');

  for (const [index, point] of TERMS_POINTS.entries()) {
    assert.equal(typeof point.title, 'string', `第 ${index + 1} 条缺标题`);
    assert.ok(point.title.trim().length > 0, `第 ${index + 1} 条标题是空的`);
    assert.equal(typeof point.body, 'string', `第 ${index + 1} 条缺正文`);
    assert.ok(point.body.trim().length > 0, `第 ${index + 1} 条正文是空的`);
  }
});

test('协议每条都够短（手表一屏要放得下三条）', () => {
  for (const point of TERMS_POINTS) {
    assert.ok(
      point.body.length <= 60,
      `「${point.title}」有 ${point.body.length} 字，太长了——三条加起来会放不下一屏`,
    );
  }
});

test('协议收尾那句话非空', () => {
  assert.ok(TERMS_FOOTNOTE.trim().length > 0);
});

test('协议标记的存储键是字符串且非空', () => {
  assert.equal(typeof TERMS_KEY, 'string');
  assert.ok(TERMS_KEY.length > 0);
});

// ══════════════════════════════════════════════════════════════════════
// 用户群
// ══════════════════════════════════════════════════════════════════════

test('群号是纯数字（否则用户搜不到）', () => {
  if (!hasCommunity()) return;
  assert.match(groupNumber(), /^\d+$/, '群号必须全是数字');
  assert.equal(groupNumber(), QQ_GROUP.trim(), '不能带两端空白');
});

test('群链接能生成，且指向 qq.com', () => {
  if (!hasCommunity() || !QQ_GROUP_URL.trim()) return;
  const url = groupUrl();
  assert.match(url, /^https:\/\/[a-z.]*qq\.com\//, '二维码里编的必须是 QQ 的链接');
});

test('没配群号时 groupUrl 返回空串（不显示二维码）', () => {
  const url = groupUrl();
  assert.equal(typeof url, 'string');
  if (!hasCommunity()) assert.equal(url, '');
});
