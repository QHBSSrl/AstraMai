/**
 * 中二节奏领域常量的单元测试。
 *
 * 重点在**难度档位**上：这是文档与实际数据不一致的地方，
 * 而且不一致的后果是静默的——少显示一整档谱面，不会报错。
 *
 * 实测依据（2026-10，直接请求落雪 /api/v0/chunithm/song/list）：
 *   档位分布 0=BAS 1406 / 1=ADV 1406 / 2=EXP 1406 / 3=MST 1406 / 4=ULT 82 / 5=WE 52
 * 文档只列了 0–4，漏掉 WORLD'S END。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CHUNITHM_CHAIN_LABELS,
  CHUNITHM_DIFFICULTY_COLORS,
  CHUNITHM_DIFFICULTY_COUNT,
  CHUNITHM_DIFFICULTY_NAMES,
  CHUNITHM_FC_LABELS,
  CHUNITHM_RANK_LABELS,
  CHUNITHM_UNKNOWN_COLOR,
  chunithmDifficultyColor,
  chunithmDifficultyName,
} from '../dist/index.js';

test('难度档位是 6 档（含 WORLD\'S END，文档漏了这档）', () => {
  assert.equal(CHUNITHM_DIFFICULTY_COUNT, 6);
  assert.equal(CHUNITHM_DIFFICULTY_NAMES.length, 6);
  assert.equal(CHUNITHM_DIFFICULTY_COLORS.length, 6);
});

test('六档的名字与顺序符合游戏内实际', () => {
  assert.deepEqual([...CHUNITHM_DIFFICULTY_NAMES], ['BAS', 'ADV', 'EXP', 'MST', 'ULT', 'WE']);
});

test('第 5 档确实是 WORLD\'S END 而不是溢出', () => {
  // 这条是这组测试存在的理由：如果哪天有人把档位改回 5 档，
  // 52 个 WORLD'S END 谱面会静默消失，不会有任何报错。
  assert.equal(chunithmDifficultyName(5), 'WE');
  assert.notEqual(chunithmDifficultyColor(5), CHUNITHM_UNKNOWN_COLOR);
});

test('每一档都有独立颜色，不能撞色', () => {
  const colors = [...CHUNITHM_DIFFICULTY_COLORS];
  assert.equal(new Set(colors).size, colors.length, '六档颜色必须互不相同，否则玩家分不清难度');
});

test('颜色都是合法的十六进制色值', () => {
  for (const color of CHUNITHM_DIFFICULTY_COLORS) {
    assert.match(color, /^#[0-9a-f]{6}$/i, `非法色值：${color}`);
  }
});

test('未知档位返回 #n 与中性色，而不是空白或崩溃', () => {
  // 上游随时可能加档位。越界时**看得见比好看重要**：
  // 返回空字符串会让 UI 上出现一个没有难度的行，比显示 #7 更难排查。
  assert.equal(chunithmDifficultyName(6), '#6');
  assert.equal(chunithmDifficultyName(99), '#99');
  assert.equal(chunithmDifficultyColor(6), CHUNITHM_UNKNOWN_COLOR);
});

test('负数档位也不崩', () => {
  assert.equal(chunithmDifficultyName(-1), '#-1');
  assert.equal(chunithmDifficultyColor(-1), CHUNITHM_UNKNOWN_COLOR);
});

test('文本映射覆盖接口可能返回的全部枚举值', () => {
  // 上游给什么就得能显示什么，漏一个就会在界面上露出原始英文
  for (const key of ['alljustice', 'fullcombo']) {
    assert.ok(CHUNITHM_FC_LABELS[key], `FC 缺映射：${key}`);
  }
  for (const key of ['fullchain', 'fullchain2']) {
    assert.ok(CHUNITHM_CHAIN_LABELS[key], `CHAIN 缺映射：${key}`);
  }
  for (const key of ['sssp', 'sss', 'ssp', 'ss', 'sp', 's', 'aaa', 'aa', 'a', 'bbb', 'bb', 'b', 'c', 'd']) {
    assert.ok(CHUNITHM_RANK_LABELS[key], `评级缺映射：${key}`);
  }
});

test('AJ 不谎称能区分 AJC', () => {
  // 上游只给 alljustice，没区分 AJ 与 AJC（文档原话：需要开发者自行判断），
  // 而判断依据不在这个接口里。所以文案只能是 AJ，不能写 AJC。
  assert.equal(CHUNITHM_FC_LABELS.alljustice, 'AJ');
  assert.ok(!JSON.stringify(CHUNITHM_FC_LABELS).includes('AJC'));
});
