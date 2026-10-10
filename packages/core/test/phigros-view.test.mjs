/**
 * Phigros 视图组装的单元测试。
 *
 * 这段逻辑有两个**静默出错**的坑，正是测试要守住的：
 *   1. `game_record` 是**字典不是数组**——当数组遍历会静默拿到空结果
 *   2. B30 里**没有分数和准确率**——不回去查字典，界面上就只有 RKS 数字
 * 两者都不会报错，只是显示得不对。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PHIGROS_DIFFICULTIES,
  buildPhigrosView,
  phigrosDifficultyColor,
  titleFromSongId,
} from '../dist/index.js';

/** 造一份最小的 /save 响应。 */
function saveResponse(overrides = {}) {
  return {
    save: {
      game_record: {
        'Spasmodic.姜米條颶風元力上人': [
          { difficulty: 'EZ', score: 1000000, accuracy: 100, is_full_combo: true, chart_constant: 8.2, push_acc: 100, push_acc_hint: { type: 'already_phi' } },
          { difficulty: 'IN', score: 987749, accuracy: 99.216965, is_full_combo: true, chart_constant: 15.5, push_acc: 100, push_acc_hint: { type: 'phi_only' } },
        ],
        '云女孩.符白牙': [
          { difficulty: 'HD', score: 931496, accuracy: 98.09, is_full_combo: false, chart_constant: 8.9, push_acc: 100, push_acc_hint: { type: 'unreachable' } },
        ],
      },
      summaryParsed: { challenge_mode_rank: 3, save_version: 12 },
      updatedAt: '2026-08-05T12:00:00Z',
    },
    rks: {
      totalRks: 13.21,
      b30Charts: [
        { songId: 'Spasmodic.姜米條颶風元力上人', difficulty: 'IN', rks: 12.5 },
        { songId: '云女孩.符白牙', difficulty: 'HD', rks: 0.71 },
      ],
    },
    gradeCounts: {},
    nickname: '测试玩家',
    ...overrides,
  };
}

test('B30 会回字典里补齐分数与准确率（否则界面只有 RKS 数字）', () => {
  const view = buildPhigrosView(saveResponse());
  const top = view.best30[0];

  assert.equal(top.songId, 'Spasmodic.姜米條颶風元力上人');
  assert.equal(top.difficulty, 'IN');
  assert.equal(top.rks, 12.5);
  // 这两条是重点：B30 原始响应里没有，必须查字典才有
  assert.equal(top.score, 987749);
  assert.ok(Math.abs(top.accuracy - 99.216965) < 1e-6);
  assert.equal(top.chartConstant, 15.5);
  assert.equal(top.isFullCombo, true);
  assert.equal(top.inBest30, true);
});

test('game_record 是字典——按数组处理会拿到空结果', () => {
  const view = buildPhigrosView(saveResponse());
  // 3 条成绩散在两个键下，必须两个都遍历到
  assert.equal(view.stats.recordCount, 3);
  assert.ok(view.stats.difficultiesPresent.includes('EZ'));
  assert.ok(view.stats.difficultiesPresent.includes('HD'));
  assert.ok(view.stats.difficultiesPresent.includes('IN'));
});

test('B30 按 RKS 降序', () => {
  const view = buildPhigrosView(saveResponse());
  assert.deepEqual(
    view.best30.map((entry) => entry.rks),
    [12.5, 0.71],
  );
});

test('满分条数按 100 万判定', () => {
  const view = buildPhigrosView(saveResponse());
  assert.equal(view.stats.phiCount, 1, '只有 1000000 那条算满分');
});

test('查不到的成绩不丢条目，只是字段为 null', () => {
  // B30 里有一首存档中不存在的歌：**不能整条丢掉**，
  // 否则玩家会以为这首歌没打，实际是数据对不上
  const data = saveResponse();
  data.rks.b30Charts.push({ songId: '不存在的歌.某人', difficulty: 'IN', rks: 9.9 });

  const view = buildPhigrosView(data);
  const ghost = view.best30.find((entry) => entry.songId === '不存在的歌.某人');
  assert.ok(ghost, '查不到的条目仍应出现在列表里');
  assert.equal(ghost.score, null);
  assert.equal(ghost.accuracy, null);
  assert.equal(ghost.rks, 9.9, 'RKS 是 B30 自带的，不该丢');
});

test('titleFromSongId 取第一个点之前的部分', () => {
  assert.equal(titleFromSongId('Spasmodic.姜米條颶風元力上人'), 'Spasmodic');
  assert.equal(titleFromSongId('云女孩.符白牙'), '云女孩');
  // 没有点时原样返回，而不是返回空串——看得见奇怪的 id 比看不见强
  assert.equal(titleFromSongId('NoDotHere'), 'NoDotHere');
  assert.equal(titleFromSongId(''), '');
});

test('难度配色四档互不相同，未知难度有中性兜底', () => {
  const colors = PHIGROS_DIFFICULTIES.map((difficulty) => phigrosDifficultyColor(difficulty));
  assert.equal(new Set(colors).size, 4, '四档颜色不能撞');
  for (const color of colors) assert.match(color, /^#[0-9a-f]{6}$/i);
  assert.equal(phigrosDifficultyColor('XX'), '#9bacd0');
});

test('Phigros 只有四档难度', () => {
  assert.deepEqual([...PHIGROS_DIFFICULTIES], ['EZ', 'HD', 'IN', 'AT']);
});

test('推分提示转成可读中文，未知类型不崩', () => {
  const view = buildPhigrosView(saveResponse());
  const inChart = view.best30.find((entry) => entry.difficulty === 'IN');
  assert.equal(inChart.pushHint, '只能冲满分');

  const data = saveResponse();
  data.save.game_record['Spasmodic.姜米條颶風元力上人'][1].push_acc_hint = { type: 'brand_new_type' };
  const other = buildPhigrosView(data);
  assert.equal(other.best30.find((e) => e.difficulty === 'IN').pushHint, null, '未知类型给 null 而不是原始英文');
});

test('空存档不崩，统计全零', () => {
  const view = buildPhigrosView({
    save: { game_record: {} },
    rks: { totalRks: 0, b30Charts: [] },
    gradeCounts: {},
    nickname: null,
  });
  assert.equal(view.best30.length, 0);
  assert.equal(view.stats.recordCount, 0);
  assert.equal(view.stats.phiCount, 0);
  assert.equal(view.nickname, '');
  assert.equal(view.rks, 0);
});

test('缺字段的响应不崩', () => {
  const view = buildPhigrosView({});
  assert.equal(view.best30.length, 0);
  assert.equal(view.rks, 0);
});

test('limit 能截断 B30', () => {
  const view = buildPhigrosView(saveResponse(), { limit: 1 });
  assert.equal(view.best30.length, 1);
  // 但统计仍然是全量存档的，不受 limit 影响
  assert.equal(view.stats.recordCount, 3);
});

test('存档时间与课题段位被带出来', () => {
  const view = buildPhigrosView(saveResponse());
  assert.equal(view.saveUpdatedAt, '2026-08-05T12:00:00Z');
  assert.equal(view.challengeModeRank, 3);
});
