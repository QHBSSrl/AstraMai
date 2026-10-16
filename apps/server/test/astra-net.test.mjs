/**
 * 自建 net 适配器的解析测试。
 *
 * ⚠️ 这里的样本数据是**从公开实例真实抓下来的**，不是编的：
 *
 *     POST https://aquadx.net/aqua/api/v2/game/mai2/user-summary?username=OHOOO
 *     → ratingComposition.best35 = "11663:4:24015:1005324,..."  (746 字符, 35 段)
 *     → ratingComposition.new15  = "19255:3:90033:1005534,..."  (329 字符, 15 段)
 *
 * 用真实数据测的理由：**映射是最容易「看着对但其实不对」的地方**。
 * 编造样本会连自己的假设一起写进测试，等于没测。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { AstraNetSource } from '../dist/sources/astra-net.js';

// ── 真实样本（截取，格式与线上一致）──────────────────────────────────
const REAL_BEST35 =
  '11663:4:24015:1005324,11662:3:24008:1008814,11394:3:22513:1008364,' +
  '833:4:19997:1008236,803:4:19993:1008090,11818:3:25512:1007924';

const REAL_NEW15 =
  '19255:3:90033:1005534,19035:3:90004:1009111,19021:3:90002:1008909,' +
  '19247:3:90032:1007725,19024:3:90002:1007668';

/** 造一个只替换 `fetch` 的源，避免测试依赖外网。 */
function sourceWith(response) {
  const source = new AstraNetSource({
    baseUrl: 'https://net.example.com',
    limiter: { spend: () => {} },
  });
  return { source, response };
}

const okResponse = (body) => ({
  ok: true,
  status: 200,
  text: async () => JSON.stringify(body),
});

function installFetch(payload) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return okResponse(payload);
  };
  return calls;
}

test('鉴权：描述里说不需要密钥，且配了地址才可用', () => {
  const source = new AstraNetSource({ baseUrl: 'https://net.example.com', limiter: { spend: () => {} } });
  const d = source.describe();
  assert.equal(d.available, true);
  assert.equal(d.requiresKey, false, '自建 net 不需要开发者密钥');
  assert.ok(d.games.includes('maimai'));
});

test('没配地址时不可用，且给出原因', () => {
  const source = new AstraNetSource({ baseUrl: '', limiter: { spend: () => {} } });
  const d = source.describe();
  assert.equal(d.available, false);
  assert.match(d.unavailableReason ?? '', /ASTRA_NET_BASE/);
});

test('只认用户名——不认好友码和 QQ 号', () => {
  const source = new AstraNetSource({ baseUrl: 'https://net.example.com', limiter: { spend: () => {} } });
  assert.equal(source.supports({ username: 'OHOOO' }), true);
  assert.equal(source.supports({ friendCode: 123456789012345 }), false, '自建 net 没有好友码概念');
  assert.equal(source.supports({ qq: 12345 }), false);
  assert.equal(source.supports({}), false);
  assert.equal(source.supports({ username: '   ' }), false, '空白用户名不算');
});

test('请求形式：POST + 查询字符串 + /aqua 前缀', async () => {
  const calls = installFetch({
    name: 'test',
    rating: 100,
    ratingComposition: { best35: REAL_BEST35, new15: REAL_NEW15 },
  });

  const { source } = sourceWith(null);
  await source.getBests({ username: 'OHOOO' });

  assert.equal(calls.length, 1);
  const { url, init } = calls[0];

  // ⚠️ 三条都是实测踩出来的：
  //    不加 /aqua 会拿到前端 SPA 的 HTML；用 GET 或放请求体会 405
  assert.match(url, /^https:\/\/net\.example\.com\/aqua\/api\/v2\/game\/mai2\/user-summary\?/);
  assert.match(url, /username=OHOOO/);
  assert.equal(init.method, 'POST');
  assert.equal(init.body, undefined, '参数必须走查询字符串，不能放请求体');
});

test('baseUrl 末尾的斜杠不会拼出双斜杠', async () => {
  const calls = installFetch({ rating: 0, ratingComposition: {} });
  const source = new AstraNetSource({
    baseUrl: 'https://net.example.com/',
    limiter: { spend: () => {} },
  });
  await source.getBests({ username: 'x' });
  assert.ok(!calls[0].url.includes('//aqua'), `不该出现双斜杠：${calls[0].url}`);
});

test('B35 解析：35 段、丢掉 romVersion、达成率除以 10000', async () => {
  installFetch({
    name: 'OHOOO',
    rating: 16692,
    ratingComposition: { best35: REAL_BEST35, new15: REAL_NEW15 },
  });

  const { source } = sourceWith(null);
  const bests = await source.getBests({ username: 'OHOOO' });

  assert.equal(bests.standard.length, 6, '样本里 best35 有 6 段');

  const first = bests.standard[0];
  assert.equal(first.id, 11663, 'musicId');
  assert.equal(first.level_index, 4, 'level 4 = Re:M');
  assert.equal(first.type, 'dx', '11663 ≥ 10000 → DX 谱面');
  // 1005324 → 100.5324
  assert.ok(Math.abs(first.achievements - 100.5324) < 1e-9, `实际 ${first.achievements}`);
});

test('new15 解析成 dx 侧', async () => {
  installFetch({ rating: 0, ratingComposition: { best35: REAL_BEST35, new15: REAL_NEW15 } });
  const { source } = sourceWith(null);
  const bests = await source.getBests({ username: 'x' });

  assert.equal(bests.dx.length, 5, '样本里 new15 有 5 段');
  assert.equal(bests.dx[0].id, 19255);
  assert.equal(bests.dx[0].level_index, 3, 'level 3 = MASTER');
  assert.equal(bests.dx[0].type, 'dx');
});

test('谱面类型按 ID 区间判定（实测分布得出的规则）', async () => {
  // 三个区间的代表值
  installFetch({
    rating: 0,
    //  < 1000        → standard
    //  10000-19999   → dx
    //  >= 20000      → utage（如 600429 = [宴]Wonderland Wars）
    ratingComposition: { best35: '833:4:19997:1008236,11663:4:24015:1005324,600429:0:0:1000000' },
  });
  const { source } = sourceWith(null);
  const bests = await source.getBests({ username: 'x' });

  assert.equal(bests.standard[0].type, 'standard', '833 是 STD');
  assert.equal(bests.standard[1].type, 'dx', '11663 是 DX');
  assert.equal(bests.standard[2].type, 'utage', '600429 是宴会场');
});

test('缺字段 / 畸形串不会崩，跳过而不是编数据', async () => {
  installFetch({
    rating: 0,
    ratingComposition: {
      // 混入畸形项：段数不足、含非数字
      best35: '11663:4:24015:1005324,,abc,1:2,11662:3:24008:1008814',
      new15: '',
    },
  });
  const { source } = sourceWith(null);
  const bests = await source.getBests({ username: 'x' });

  assert.equal(bests.standard.length, 2, '只保留两条合法项');
  assert.equal(bests.dx.length, 0, '空串给空数组，不是 [""]');
});

test('ratingComposition 整个缺失时给空 B50，而不是抛错', async () => {
  installFetch({ name: 'x', rating: 100 });
  const { source } = sourceWith(null);
  const bests = await source.getBests({ username: 'x' });
  assert.deepEqual(bests.standard, []);
  assert.deepEqual(bests.dx, []);
});

test('玩家信息：没有好友码时给 0，不编假号码', async () => {
  installFetch({ name: 'ＯＨＯＯＯＯＯＯ', rating: 16692, ratingComposition: {} });
  const { source } = sourceWith(null);
  const player = await source.getPlayer({ username: 'OHOOO' });

  assert.equal(player.name, 'ＯＨＯＯＯＯＯＯ');
  assert.equal(player.rating, 16692);
  assert.equal(player.friend_code, 0, '自建 net 没有好友码，填 0 而不是编一个');
});

test('404 "Game data not found" 转成人话，不当成服务器故障', async () => {
  globalThis.fetch = async () => ({
    ok: false,
    status: 404,
    text: async () => 'Game data not found',
  });

  const { source } = sourceWith(null);
  await assert.rejects(
    () => source.getBests({ username: 'OHOOO' }),
    (error) => {
      assert.equal(error.kind, 'not-found');
      // 属性是 `friendlyMessage`（getter），不是 `friendly`——
      // 那是构造参数的名字。第一版测试写错了这个，报了假失败。
      assert.match(error.friendlyMessage, /没有该游戏的存档/);
      return true;
    },
  );
});

test('网络异常归类为 network，不是 server', async () => {
  globalThis.fetch = async () => {
    throw new Error('ECONNREFUSED');
  };
  const { source } = sourceWith(null);
  await assert.rejects(
    () => source.getBests({ username: 'x' }),
    (error) => {
      assert.equal(error.kind, 'network');
      return true;
    },
  );
});
