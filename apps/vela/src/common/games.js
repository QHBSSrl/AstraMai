/**
 * 支持的游戏注册表。
 *
 * 放在这里而不是散在各个页面里：加游戏时会同时影响首页菜单、
 * 设置页的切换项、以及各页面向服务端请求时的路径前缀，
 * **只有一处定义才不会漏改**。
 *
 * ⚠️ 这里的 `id` 必须和服务端的接口路径前缀一致：
 *   舞萌   /api/v1/maimai/*
 *   中二   /api/v1/chunithm/*
 */

/** 本地存储里记录当前游戏的键。 */
export const CURRENT_GAME_KEY = 'currentGame';

/**
 * 游戏列表。
 *
 * `features` 决定首页显示哪些入口——中二目前只有曲库与搜索，
 * 查分还没接，所以不放 Best 50。**宁可少显示，也别点进去报错。**
 */
export const GAMES = [
  {
    id: 'maimai',
    label: '舞萌 DX',
    short: '舞萌',
    features: ['b50', 'search', 'qr'],
  },
  {
    id: 'chunithm',
    label: '中二节奏',
    short: '中二',
    // 查分已接（B30 + Selection10 + Recent10），见 /api/v1/chunithm/bests
    features: ['b50', 'search'],
  },
];

/** 默认游戏。 */
export const DEFAULT_GAME_ID = 'maimai';

/** 按 id 取游戏；认不出就回退到默认值，而不是返回 undefined 让调用方崩。 */
export function gameById(id) {
  return GAMES.find((game) => game.id === id) ?? GAMES[0];
}

/** 这个游戏有没有某个功能。 */
export function gameHasFeature(game, feature) {
  return Boolean(game && game.features && game.features.indexOf(feature) >= 0);
}

/**
 * 读当前游戏。
 *
 * 传入存储读写函数而不是直接 import store：
 * 保持这个模块零依赖，就也能在 Node 里做测试。
 */
export function readCurrentGame(readSetting) {
  const saved = readSetting(CURRENT_GAME_KEY, '');
  return gameById(saved).id;
}

/** 写当前游戏。只接受已知 id，避免存进一个拼错的值让下次启动回退。 */
export function writeCurrentGame(writeSetting, id) {
  const game = gameById(id);
  writeSetting(CURRENT_GAME_KEY, game.id);
  return game.id;
}
