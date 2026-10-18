/**
 * osu! 适配器的测试。
 *
 * ── 关于样本数据 ────────────────────────────────────────────────────
 *
 * ⚠️ **这里的响应样本是按官方文档的字段形状造的，不是抓取的。**
 *
 * 为什么不像 astra-net 那样用真实样本：**这个源需要 OSU_CLIENT_ID /
 * OSU_CLIENT_SECRET 才能调用**，写这段时还没有凭据。
 *
 * 所以这批测试覆盖的是：
 *   ✅ 字段缺失时的容错（上游很多字段可为 null）
 *   ✅ token 缓存与失效逻辑（不依赖上游）
 *   ✅ 限流计数（不依赖上游）
 *   ✅ 错误分类（404 / 401 / 5xx）
 *   ❌ **不覆盖**「上游真实字段名和我们对不对得上」
 *
 * 拿到凭据后必须补一条对真实接口的集成测试——**这是已知的验证缺口**，
 * 不要因为这里全绿就认为映射一定对。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { OsuSource, mapPlayer, mapScore } from '../dist/sources/osu.js';
import { UpstreamLimiter } from '../dist/sources/upstream-limiter.js';

// ── 官方文档形状的样本 ────────────────────────────────────────────────

/** `/users/{user}/{ruleset}` 的响应。 */
const PLAYER_SAMPLE = {
  id: 1234567,
  username: 'Cookiezi',
  country_code: 'KR',
  playmode: 'osu',
  statistics: {
    global_rank: 42,
    country_rank: 1,
    pp: 12345.67,
    accuracy: 0.98765,
    play_count: 98765,
  },
};

/** `/users/{user}/scores/best` 里的一条。 */
const SCORE_SAMPLE = {
  id: 999,
  accuracy: 0.9965,
  mods: ['HD', 'HR'],
  score: 1234567,
  max_combo: 1337,
  rank: 'S',
  pp: 456.78,
  weight: { percent: 100, pp: 456.78 },
  beatmap: { id: 12345, version: 'Insane', difficulty_rating: 6.12 },
  beatmapset: {
    title: 'Blue Zenith',
    artist: 'xi',
    covers: { cover: 'https://assets.ppy.sh/beatmaps/1/covers/cover.jpg' },
  },
};

/** 造一个替换了 fetch 的源。 */
function makeSource(handler, options = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init);
  };

  const source = new OsuSource({
    clientId: 'test-id',
    clientSecret: 'test-secret',
    limiter: new UpstreamLimiter(options.limit ?? 50),
    fetchImpl,
    ...(options.bestLimit ? { bestLimit: options.bestLimit } : {}),
  });

  return { source, calls };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function tokenResponse() {
  return jsonResponse({ access_token: 'fake-token', expires_in: 86400, token_type: 'Bearer' });
}

// ══════════════════════════════════════════════════════════════════════
// 映射
// ══════════════════════════════════════════════════════════════════════

test('玩家资料：正常字段全部映射到位', () => {
  const player = mapPlayer(PLAYER_SAMPLE, 'osu');
  assert.equal(player.id, 1234567);
  assert.equal(player.username, 'Cookiezi');
  assert.equal(player.globalRank, 42);
  assert.equal(player.countryRank, 1);
  assert.equal(player.countryCode, 'KR');
  assert.equal(player.pp, 12345.67);
  assert.equal(player.accuracy, 0.98765, '准确率保持 0–1，不在这一层乘 100');
  assert.equal(player.playCount, 98765);
  assert.equal(player.ruleset, 'osu');
});

test('玩家资料：statistics 整个缺失也不崩', () => {
  // 新号 / 从没打过这个玩法时上游可能不给 statistics
  const player = mapPlayer({ id: 1, username: 'newbie' }, 'taiko');
  assert.equal(player.username, 'newbie');
  assert.equal(player.globalRank, null, '没有排名应当是 null，不是 0');
  assert.equal(player.pp, 0);
  assert.equal(player.accuracy, 0);
});

test('玩家资料：global_rank 为 null 时保持 null', () => {
  const player = mapPlayer({ id: 2, username: 'x', statistics: { global_rank: null } }, 'osu');
  assert.equal(player.globalRank, null, 'null 和 0 是两回事——0 名不存在');
});

test('玩家资料：完全空的输入也能给出结构', () => {
  const player = mapPlayer(null, 'osu');
  assert.equal(player.username, '未知玩家');
  assert.equal(player.pp, 0);
});

test('成绩：正常字段全部映射到位', () => {
  const score = mapScore(SCORE_SAMPLE);
  assert.ok(score);
  assert.equal(score.pp, 456.78);
  assert.equal(score.weightedPp, 456.78);
  assert.equal(score.weightPercent, 100);
  assert.equal(score.accuracy, 0.9965);
  assert.equal(score.rank, 'S');
  assert.deepEqual(score.mods, ['HD', 'HR']);
  assert.equal(score.score, 1234567);
  assert.equal(score.maxCombo, 1337);
  assert.equal(score.beatmapId, 12345);
  assert.equal(score.version, 'Insane');
  assert.equal(score.starRating, 6.12);
  assert.equal(score.title, 'xi - Blue Zenith');
  assert.match(score.coverUrl, /assets\.ppy\.sh/);
});

test('成绩：pp 为 null 时归一成 0（未进榜的谱面）', () => {
  const score = mapScore({ ...SCORE_SAMPLE, pp: null });
  assert.ok(score);
  assert.equal(score.pp, 0, 'null 会让排序和求和出 NaN，必须归一');
  assert.ok(Number.isFinite(score.pp));
});

test('成绩：beatmapset 缺失时标题不崩', () => {
  const score = mapScore({ ...SCORE_SAMPLE, beatmapset: undefined, beatmap: undefined });
  assert.ok(score);
  assert.equal(score.title, '未知曲目');
  assert.equal(score.version, '未知难度');
  assert.equal(score.starRating, 0);
  assert.equal(score.coverUrl, '');
});

test('成绩：只有 artist 没有 title 时也能拼', () => {
  const score = mapScore({
    ...SCORE_SAMPLE,
    beatmapset: { artist: 'xi' },
  });
  assert.ok(score);
  assert.equal(score.title, 'xi');
});

test('成绩：mods 里的脏数据被过滤掉', () => {
  const score = mapScore({ ...SCORE_SAMPLE, mods: ['HD', null, '', 42, 'DT'] });
  assert.ok(score);
  assert.deepEqual(score.mods, ['HD', 'DT'], '只留非空字符串');
});

test('成绩：非对象输入返回 null 而不是抛错', () => {
  assert.equal(mapScore(null), null);
  assert.equal(mapScore('字符串'), null);
  assert.equal(mapScore(42), null);
});

// ══════════════════════════════════════════════════════════════════════
// 查询
// ══════════════════════════════════════════════════════════════════════

test('查成绩：两个请求，且用上了缓存 token', async () => {
  const { source, calls } = makeSource((url) => {
    if (url.includes('/oauth/token')) return tokenResponse();
    if (url.includes('/scores/best')) return jsonResponse([SCORE_SAMPLE]);
    return jsonResponse(PLAYER_SAMPLE);
  });

  const bests = await source.getOsuBests({ username: 'Cookiezi' });

  assert.equal(bests.player.username, 'Cookiezi');
  assert.equal(bests.scores.length, 1);
  assert.equal(bests.totalPp, 12345.67);

  // 1 次 token + 2 次数据
  assert.equal(calls.length, 3);
  assert.ok(calls[0].url.includes('/oauth/token'));
  assert.ok(calls[1].url.includes('/users/Cookiezi/osu'), calls[1].url);
  assert.ok(calls[2].url.includes('/scores/best'), calls[2].url);
  assert.ok(calls[2].url.includes('mode=osu'));

  // 后续请求复用 token，不再打 /oauth/token
  assert.equal(calls[1].init.headers.Authorization, 'Bearer fake-token');
});

test('token 会被缓存：第二次查询不再换 token', async () => {
  const { source, calls } = makeSource((url) => {
    if (url.includes('/oauth/token')) return tokenResponse();
    if (url.includes('/scores/best')) return jsonResponse([]);
    return jsonResponse(PLAYER_SAMPLE);
  });

  await source.getOsuBests({ username: 'a' });
  const tokenCallsAfterFirst = calls.filter((c) => c.url.includes('/oauth/token')).length;
  await source.getOsuBests({ username: 'b' });
  const tokenCallsAfterSecond = calls.filter((c) => c.url.includes('/oauth/token')).length;

  assert.equal(tokenCallsAfterFirst, 1);
  assert.equal(tokenCallsAfterSecond, 1, '第二次查询不该再换 token——会白白消耗配额');
});

test('401 时清掉 token，下次重新获取', async () => {
  let tokenCount = 0;
  let dataCount = 0;
  const { source } = makeSource((url) => {
    if (url.includes('/oauth/token')) {
      tokenCount += 1;
      return tokenResponse();
    }
    dataCount += 1;
    // 第一次数据请求返回 401
    if (dataCount === 1) return jsonResponse({ error: 'unauthorized' }, 401);
    return jsonResponse(PLAYER_SAMPLE);
  });

  await assert.rejects(
    () => source.getOsuPlayer({ username: 'x' }),
    (error) => {
      assert.equal(error.kind, 'unauthorized');
      assert.match(error.friendlyMessage, /认证失效/);
      return true;
    },
  );

  // 再查一次：应该重新取 token
  await source.getOsuPlayer({ username: 'x' });
  assert.equal(tokenCount, 2, '401 之后必须重新换 token');
});

test('404 给出「用户名不存在」而不是通用错误', async () => {
  const { source } = makeSource((url) => {
    if (url.includes('/oauth/token')) return tokenResponse();
    return jsonResponse({ error: 'not found' }, 404);
  });

  await assert.rejects(
    () => source.getOsuPlayer({ username: 'nobody' }),
    (error) => {
      assert.equal(error.kind, 'not-found');
      assert.match(error.friendlyMessage, /不存在/);
      return true;
    },
  );
});

test('token 拿不到时说明是配置问题，不是玩家的错', async () => {
  const { source } = makeSource(() => jsonResponse({ error: 'invalid_client' }, 401));

  await assert.rejects(
    () => source.getOsuPlayer({ username: 'x' }),
    (error) => {
      assert.equal(error.kind, 'server');
      assert.match(error.friendlyMessage, /服务器配置问题/);
      assert.match(error.friendlyMessage, /不是你的账号问题/);
      return true;
    },
  );
});

test('没有用户名时直接拒绝，不发请求', async () => {
  const { source, calls } = makeSource(() => jsonResponse({}));
  await assert.rejects(() => source.getOsuBests({ friendCode: 123 }), /用户名/);
  assert.equal(calls.length, 0, '参数不对就不该花配额');
});

test('supports 只认用户名', () => {
  const { source } = makeSource(() => jsonResponse({}));
  assert.equal(source.supports({ username: 'Cookiezi' }), true);
  assert.equal(source.supports({ username: '   ' }), false);
  assert.equal(source.supports({ friendCode: 123 }), false);
  assert.equal(source.supports({ qq: 12345 }), false);
});

// ══════════════════════════════════════════════════════════════════════
// 限流
// ══════════════════════════════════════════════════════════════════════

test('一次查询花 2 个上游配额', async () => {
  const limiter = new UpstreamLimiter(10);
  const source = new OsuSource({
    clientId: 'id',
    clientSecret: 'secret',
    limiter,
    fetchImpl: async (url) => {
      if (String(url).includes('/oauth/token')) return tokenResponse();
      if (String(url).includes('/scores/best')) return jsonResponse([SCORE_SAMPLE]);
      return jsonResponse(PLAYER_SAMPLE);
    },
  });

  await source.getOsuBests({ username: 'x' });
  assert.equal(limiter.status().usedThisMinute, 2);
});

test('预算用尽后拒绝，且不再请求上游', async () => {
  const limiter = new UpstreamLimiter(1);
  let dataCalls = 0;
  const source = new OsuSource({
    clientId: 'id',
    clientSecret: 'secret',
    limiter,
    fetchImpl: async (url) => {
      if (String(url).includes('/oauth/token')) return tokenResponse();
      dataCalls += 1;
      return jsonResponse(PLAYER_SAMPLE);
    },
  });

  // 预算只有 1，但一次查询要 2
  await assert.rejects(
    () => source.getOsuBests({ username: 'x' }),
    (error) => {
      assert.equal(error.kind, 'rate-limited');
      return true;
    },
  );
  assert.equal(dataCalls, 0, '超限时不该真的打到上游');
});

test('硬件上限：hardLimitPerMinute 声明为 50（ToS 是 60，留余量）', () => {
  const { source } = makeSource(() => jsonResponse({}));
  assert.equal(source.hardLimitPerMinute, 50);
});

test('注册表会让硬上限与全局预算取小', async () => {
  const { SourceRegistry } = await import('../dist/sources/registry.js');

  // 全局 150，osu 硬上限 50 → 取 50
  const registry = new SourceRegistry(150);
  const { source } = makeSource(() => jsonResponse({}));
  registry.register(source);
  assert.equal(registry.limiterFor('osu').status().limitPerMinute, 50);

  // 全局 30 比硬上限更低 → 取 30
  const tight = new SourceRegistry(30);
  const { source: source2 } = makeSource(() => jsonResponse({}));
  tight.register(source2);
  assert.equal(tight.limiterFor('osu').status().limitPerMinute, 30);
});

// ══════════════════════════════════════════════════════════════════════
// 其它接口
// ══════════════════════════════════════════════════════════════════════

test('舞萌接口明确拒绝，而不是返回假数据', async () => {
  const { source } = makeSource(() => jsonResponse({}));
  await assert.rejects(() => source.getPlayer(), /不提供舞萌玩家信息/);
  await assert.rejects(() => source.getBests(), /不提供舞萌 Best 50/);
  await assert.rejects(() => source.fetchLibrary(), /不提供舞萌曲库/);
});

test('describe 的报告里 games 只有 osu', () => {
  const { source } = makeSource(() => jsonResponse({}));
  const descriptor = source.describe();
  assert.deepEqual(descriptor.games, ['osu']);
  assert.equal(descriptor.requiresKey, true);
  assert.equal(descriptor.available, true);
});
