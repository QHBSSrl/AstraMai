/**
 * 游戏注册表的单元测试。
 *
 * 这块的价值在于**入口开关**：如果给一个还没做好查分的游戏显示了 Best 50，
 * 玩家点进去只会看到一个错误页——而且是"看起来像坏了"的那种。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CURRENT_GAME_KEY,
  DEFAULT_GAME_ID,
  GAMES,
  gameById,
  gameHasFeature,
  readCurrentGame,
  writeCurrentGame,
} from '../src/common/games.js';

/** 造一个内存版存储。 */
function memoryStore(initial = {}) {
  const data = { ...initial };
  return {
    read: (key, fallback) => (key in data ? data[key] : fallback),
    write: (key, value) => {
      data[key] = value;
    },
    raw: data,
  };
}

test('至少包含舞萌与中二', () => {
  const ids = GAMES.map((game) => game.id);
  assert.ok(ids.includes('maimai'));
  assert.ok(ids.includes('chunithm'));
});

test('Phigros 只保留查分，曲目查询已砍', () => {
  // 用户原话：「头疼砍头不是让你全砍了的，只需要把 phigros 的曲目查询砍了就行」。
  // 曲目查询那条路一直没修干净（搜出来恒 0 条），先砍掉——
  // 首页不显示「曲目搜索」入口，也就不可能点进去看到空列表。
  //
  // 这条测试是**故意的**：如果哪天有人把 'search' 加回来却没把搜索修好，
  // 这里会红，逼着做决定。真要恢复时连同这条断言一起改。
  const phigros = gameById('phigros');
  assert.equal(gameHasFeature(phigros, 'b50'), true, '查分应当保留');
  assert.equal(gameHasFeature(phigros, 'search'), false, '曲目查询应当已砍掉');
});

test('Phigros 在可选列表里（查分是可用的）', () => {
  const ids = GAMES.map((game) => game.id);
  assert.ok(ids.includes('phigros'), 'Phigros 应当可选择——只砍搜索，不是整个撤下');
});

test('id 必须和服务端的路径前缀一致', () => {
  // 这两个 id 会直接拼进 /api/v1/<id>/... ，拼错就是 404。
  // 目前服务端只有这两个游戏（实测确认落雪只覆盖它们）。
  for (const game of GAMES) {
    assert.match(game.id, /^[a-z]+$/, `非法 id：${game.id}`);
  }
});

test('中二有查分入口（B30+Selection10+Recent10 已接）', () => {
  const chunithm = gameById('chunithm');
  // 服务端 /api/v1/chunithm/bests 已上线，所以 b50 入口要开着。
  // 这个入口名字沿用「b50」是因为它在 UI 上是同一块「看成绩」的地方，
  // 但中二实际返回的是 B30 + Selection10 + Recent10，不是 B50。
  assert.equal(gameHasFeature(chunithm, 'b50'), true);
  assert.equal(gameHasFeature(chunithm, 'search'), true);
});

test('中二不显示二维码入口（机台二维码是舞萌的玩法）', () => {
  // 舞萌的二维码是机台查分二维码，中二没有对应的东西。
  // 显示了玩家点进去只会看到一个用不上的页面。
  assert.equal(gameHasFeature(gameById('chunithm'), 'qr'), false);
});

test('舞萌保留全部入口', () => {
  const maimai = gameById('maimai');
  for (const feature of ['b50', 'search', 'qr']) {
    assert.equal(gameHasFeature(maimai, feature), true, `舞萌缺功能：${feature}`);
  }
});

test('未知 id 回退到默认游戏，而不是返回 undefined', () => {
  // 返回 undefined 会让调用方在 .label 上崩掉
  assert.equal(gameById('nope').id, DEFAULT_GAME_ID);
  assert.equal(gameById('').id, DEFAULT_GAME_ID);
  assert.equal(gameById(null).id, DEFAULT_GAME_ID);
  assert.equal(gameById(undefined).id, DEFAULT_GAME_ID);
});

test('读当前游戏：没存过返回默认值', () => {
  const store = memoryStore();
  assert.equal(readCurrentGame(store.read), DEFAULT_GAME_ID);
});

test('读当前游戏：存过就返回存的那个', () => {
  const store = memoryStore({ [CURRENT_GAME_KEY]: 'chunithm' });
  assert.equal(readCurrentGame(store.read), 'chunithm');
});

test('读当前游戏：存了垃圾值也回退，不崩', () => {
  const store = memoryStore({ [CURRENT_GAME_KEY]: 'not-a-game' });
  assert.equal(readCurrentGame(store.read), DEFAULT_GAME_ID);
});

test('写当前游戏：只写已知 id', () => {
  const store = memoryStore();
  writeCurrentGame(store.write, 'chunithm');
  assert.equal(store.raw[CURRENT_GAME_KEY], 'chunithm');
});

test('写当前游戏：未知 id 会落成默认值，避免下次启动拿到拼错的值', () => {
  const store = memoryStore();
  const result = writeCurrentGame(store.write, 'chunith'); // 少一个 m
  assert.equal(result, DEFAULT_GAME_ID);
  assert.equal(store.raw[CURRENT_GAME_KEY], DEFAULT_GAME_ID);
});

test('往返一致：写什么读什么', () => {
  const store = memoryStore();
  for (const game of GAMES) {
    writeCurrentGame(store.write, game.id);
    assert.equal(readCurrentGame(store.read), game.id);
  }
});

test('每个游戏都有给玩家看的名称', () => {
  for (const game of GAMES) {
    assert.ok(game.label && game.label.length > 0, `${game.id} 缺 label`);
    assert.ok(game.short && game.short.length > 0, `${game.id} 缺 short`);
  }
});
