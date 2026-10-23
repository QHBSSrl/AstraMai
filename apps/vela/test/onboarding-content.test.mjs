/**
 * 引导内容（协议 / 教程）的结构测试。
 *
 * ── 为什么内容也要测 ────────────────────────────────────────────────
 *
 * 这两块最容易被"后来改文案"改坏，而且坏了是**静默的**：
 *   · 协议里某节忘了写 body → 屏幕上只剩一个标题
 *   · 教程某步没有 title → 卡片是空的
 *
 * 所以断言的是**结构完整性**，不是具体文案
 * （文案会改，结构不该变）。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { TERMS_KEY, TERMS_SECTIONS, TERMS_SUMMARY, TERMS_VERSION } from '../src/common/legal.js';
import { TUTORIAL_STEPS } from '../src/common/tutorial.js';

// ══════════════════════════════════════════════════════════════════════
// 用户协议
// ══════════════════════════════════════════════════════════════════════

test('协议有版本号，且是 ISO 日期格式', () => {
  assert.equal(typeof TERMS_VERSION, 'string');
  assert.match(TERMS_VERSION, /^\d{4}-\d{2}-\d{2}$/, '版本号用日期，方便排序和判断新旧');
});

test('协议至少有一节，且每节都有标题和正文', () => {
  assert.ok(Array.isArray(TERMS_SECTIONS));
  assert.ok(TERMS_SECTIONS.length > 0, '协议不能是空的');

  for (const [index, section] of TERMS_SECTIONS.entries()) {
    assert.equal(typeof section.title, 'string', `第 ${index + 1} 节缺标题`);
    assert.ok(section.title.trim().length > 0, `第 ${index + 1} 节标题是空的`);
    assert.equal(typeof section.body, 'string', `第 ${index + 1} 节缺正文`);
    assert.ok(section.body.trim().length > 0, `第 ${index + 1} 节正文是空的`);
  }
});

test('协议每节都够短（手表一屏放不下长段落）', () => {
  for (const section of TERMS_SECTIONS) {
    assert.ok(
      section.body.length <= 200,
      `「${section.title}」有 ${section.body.length} 字，太长了——手表上会变成滚动地狱`,
    );
  }
});

test('协议摘要非空', () => {
  assert.ok(TERMS_SUMMARY.trim().length > 0);
});

test('协议标记的存储键是字符串且不是空', () => {
  assert.equal(typeof TERMS_KEY, 'string');
  assert.ok(TERMS_KEY.length > 0);
});

// ══════════════════════════════════════════════════════════════════════
// 教程
// ══════════════════════════════════════════════════════════════════════

test('教程有内容，每步都有标题和正文', () => {
  assert.ok(Array.isArray(TUTORIAL_STEPS));
  assert.ok(TUTORIAL_STEPS.length > 0);

  for (const [index, step] of TUTORIAL_STEPS.entries()) {
    assert.ok(step.title && step.title.trim().length > 0, `第 ${index + 1} 步缺标题`);
    assert.ok(step.body && step.body.trim().length > 0, `第 ${index + 1} 步缺正文`);
  }
});

test('教程的 image 字段要么是空串，要么是个路径', () => {
  for (const step of TUTORIAL_STEPS) {
    // `image` 可以没有（undefined），也可以是空串——两种都表示"没有图"
    if (step.image === undefined || step.image === '') continue;
    assert.equal(typeof step.image, 'string');
    assert.match(step.image, /^\/|^https?:/, `图片路径要能以 / 或 http 开头，实际是：${step.image}`);
    assert.doesNotMatch(step.image, /\.(svg|webp)$/i, 'Vela 不支持 SVG / webp');
  }
});

test('教程每步正文够短', () => {
  for (const step of TUTORIAL_STEPS) {
    assert.ok(step.body.length <= 120, `「${step.title}」正文 ${step.body.length} 字，太长了`);
  }
});
