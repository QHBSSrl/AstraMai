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
 * `features` 决定首页显示哪些入口。
 * `queryKinds` 决定查分页显示哪些输入方式——**没声明的就不要显示**，
 * 否则会出现「切到 osu 还让你填好友码」这种明显错位。
 */
export const GAMES = [
  {
    id: 'maimai',
    label: '舞萌 DX',
    short: '舞萌',
    features: ['b50', 'search', 'qr'],
    queryKinds: ['friendCode', 'qq'],
    /** 查分页标题。 */
    b50Title: 'Best 50',
  },
  {
    id: 'phigros',
    label: 'Phigros',
    short: 'phi',
    // 曲目查询**已恢复**（曾因「恒 0 条」砍掉）。
    //
    // 恢复前重新验过整条链路：取数 → 归一 → 映射，18/18 通过。
    //   实测：Spasmodic / 君往何处 / 云 都能搜到，定数正确
    //   反向验证：形状没归一的话就是当初那个 bug
    //
    // 当初的两个根因都已修：
    //   1. 平台返回 { items }，页面读 payload.results → 在 api.js 里归一成 { results }
    //   2. gameId 在存储预热之前就读了 → 改成预热之后再读
    features: ['b50', 'search'],
    // 靠 TapTap 扫码登录，**没有「输入一个码」这回事**
    queryKinds: [],
    b50Title: 'RKS / B30',
  },
  {
    id: 'chunithm',
    label: '中二节奏',
    short: '中二',
    // 查分已接（B30 + Selection10 + Recent10），见 /api/v1/chunithm/bests
    features: ['b50', 'search'],
    queryKinds: ['friendCode', 'qq'],
    b50Title: 'Best 30',
  },
  /*
   * ══════════════════════════════════════════════════════════════════
   *  osu! —— **暂时隐藏，v0.1.2 再放出来**
   * ══════════════════════════════════════════════════════════════════
   *
   * 为什么藏：v0.1.1 要发了，但 osu 端到端还没在真机上验过——
   * 尤其「输入框能不能输字母」这条，只在单元测试里验过，
   * 没有真机确认。**带着一个没验过的入口发版比不发更糟**：
   * 玩家点进去输不进字，会以为整个 App 有问题。
   *
   * 藏的方式是**把这个条目注释掉**，不是删代码：
   *   · 服务端的 /api/v1/osu/bests 仍然在，只是没人调
   *   · b50.ux 里的 queryOsu / applyOsu 仍然在，只是走不到
   *   · validate.js 的 username 那套仍然在，单元测试也还测着
   *
   * 因为 `gameById` 有兜底（认不出就回退到 GAMES[0]），
   * 万一把 osu 存进 `currentGame` 的旧状态，也会安全回退到舞萌。
   *
   * **恢复方法**：把下面这块注释去掉即可，不用改任何其它文件。
   *
   *   {
   *     id: 'osu',
   *     label: 'osu!',
   *     short: 'osu',
   *     features: ['b50'],
   *     queryKinds: ['username'],
   *     b50Title: 'Best Plays',
   *   },
   *
   * 恢复前必须做的验证（`scripts/verify-osu-live.mjs` 已备好）：
   *   1. node scripts/verify-osu-live.mjs <用户名>   —— 接口通
   *   2. 真机上试一次输入框能不能输字母
   *   3. 真机上确认成绩页的 pp / 星数 / MOD 显示正常
   */
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
 * 这个游戏支持哪些查询方式。
 *
 * 返回**拷贝**而不是原数组：调用方（页面）会把它存进 viewModel，
 * 直接给原数组的话，任何误改都会污染注册表。
 */
export function queryKindsOf(game) {
  return (game && game.queryKinds ? game.queryKinds : []).slice();
}

/** 这个游戏的查分页标题。 */
export function b50TitleOf(game) {
  return (game && game.b50Title) || 'Best 50';
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
