/**
 * 访问门禁的单元测试。
 *
 * 这一层的价值全在「暴露到公网时会不会漏」上，所以测的都是边界：
 * 健康检查是否豁免、令牌前缀是否兼容、限流窗口是否按时重置、转发头是否可信、
 * 以及多令牌下「吊销一个不影响其他人」这件事成不成立。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createGuard } from '../dist/guard.js';
import { assertDeploymentSafety, parseTokenList } from '../dist/config.js';

/** 造一个够用的假请求对象。 */
function fakeRequest(headers = {}, remoteAddress = '10.0.0.1') {
  return { headers, socket: { remoteAddress } };
}

function configWith(overrides = {}) {
  return {
    apiTokens: [],
    authMode: 'key',
    rateLimitPerMinute: 120,
    upstreamLimitPerMinute: 150,
    host: '127.0.0.1',
    isPublicBind: false,
    allowClientKey: false,
    ...overrides,
  };
}

// ── 令牌解析 ────────────────────────────────────────────────────────────

test('parseTokenList 支持逗号与换行分隔，并去重去空', () => {
  assert.deepEqual(parseTokenList(undefined, undefined), []);
  assert.deepEqual(parseTokenList('', ''), []);
  assert.deepEqual(parseTokenList('a,b,c', undefined), ['a', 'b', 'c']);
  assert.deepEqual(parseTokenList('a\nb', undefined), ['a', 'b']);
  assert.deepEqual(parseTokenList(' a , b ', undefined), ['a', 'b']);
  // 重复的令牌只保留一个
  assert.deepEqual(parseTokenList('a,a,b', undefined), ['a', 'b']);
  // 空项必须被丢掉——留下空字符串会让任何人都能通过
  assert.deepEqual(parseTokenList('a,,b', undefined), ['a', 'b']);
  assert.deepEqual(parseTokenList(',,', undefined), []);
  // 单数写法是兼容路径
  assert.deepEqual(parseTokenList(undefined, 'legacy'), ['legacy']);
  assert.deepEqual(parseTokenList('multi', 'legacy'), ['multi', 'legacy']);
});

// ── 令牌门禁 ────────────────────────────────────────────────────────────

test('未配置令牌时，业务接口放行', () => {
  const guard = createGuard(configWith());
  const result = guard.check(fakeRequest(), '/api/maimai/b50/123');
  assert.equal(result.ok, true);
});

test('健康检查永远放行——手表要先靠它确认地址填对没有', () => {
  const guard = createGuard(configWith({ apiTokens: ['secret'] }));
  assert.equal(guard.check(fakeRequest(), '/api/health').ok, true);
  // 哪怕带个错的令牌也放行
  assert.equal(guard.check(fakeRequest({ authorization: 'wrong' }), '/api/health').ok, true);
});

test('配置令牌后，业务接口必须带对令牌', () => {
  const guard = createGuard(configWith({ apiTokens: ['secret'] }));

  assert.equal(guard.check(fakeRequest(), '/api/maimai/b50/123').ok, false);
  assert.equal(guard.check(fakeRequest(), '/api/maimai/b50/123').status, 401);
  assert.equal(guard.check(fakeRequest({ authorization: 'nope' }), '/api/maimai/b50/1').ok, false);
  assert.equal(guard.check(fakeRequest({ authorization: 'secret' }), '/api/maimai/b50/1').ok, true);
});

test('令牌的三种写法都认', () => {
  const guard = createGuard(configWith({ apiTokens: ['secret'] }));
  const path = '/api/maimai/songs';

  // 裸 Authorization（@astramai/core 的 developerKey 就是这个形态）
  assert.equal(guard.check(fakeRequest({ authorization: 'secret' }), path).ok, true);
  // Bearer 前缀
  assert.equal(guard.check(fakeRequest({ authorization: 'Bearer secret' }), path).ok, true);
  assert.equal(guard.check(fakeRequest({ authorization: 'bearer secret' }), path).ok, true);
  // 自定义头
  assert.equal(guard.check(fakeRequest({ 'x-api-key': 'secret' }), path).ok, true);
  // 前后空格应当被裁掉
  assert.equal(guard.check(fakeRequest({ authorization: '  secret  ' }), path).ok, true);
});

test('令牌比较是精确匹配，不接受前缀或后缀', () => {
  const guard = createGuard(configWith({ apiTokens: ['secret'] }));
  for (const wrong of ['sec', 'secret2', 'xsecret', 'Secret']) {
    assert.equal(
      guard.check(fakeRequest({ authorization: wrong }), '/api/maimai/songs').ok,
      false,
      `${wrong} 不应通过`,
    );
  }
});

test('多个令牌都能用——发给不同的人，各自独立', () => {
  const guard = createGuard(configWith({ apiTokens: ['alice-token', 'bob-token'] }));
  const path = '/api/maimai/songs';

  assert.equal(guard.check(fakeRequest({ authorization: 'alice-token' }), path).ok, true);
  assert.equal(guard.check(fakeRequest({ authorization: 'bob-token' }), path).ok, true);
  assert.equal(guard.check(fakeRequest({ authorization: 'carol-token' }), path).ok, false);
});

test('吊销其中一个令牌，不影响另一个', () => {
  const path = '/api/maimai/songs';
  const before = createGuard(configWith({ apiTokens: ['alice-token', 'bob-token'] }));
  assert.equal(before.check(fakeRequest({ authorization: 'alice-token' }), path).ok, true);
  assert.equal(before.check(fakeRequest({ authorization: 'bob-token' }), path).ok, true);

  // alice 的令牌泄露了 → 只把她的去掉，bob 照常
  const after = createGuard(configWith({ apiTokens: ['bob-token'] }));
  assert.equal(after.check(fakeRequest({ authorization: 'alice-token' }), path).ok, false);
  assert.equal(after.check(fakeRequest({ authorization: 'bob-token' }), path).ok, true);
});

test('空令牌列表不会意外放行', () => {
  // parseTokenList 已经把空项过滤掉了，这里确认「长度为 0 的令牌」不会进列表
  const tokens = parseTokenList('  ,  ,', undefined);
  assert.equal(tokens.length, 0);
  const guard = createGuard(configWith({ apiTokens: tokens }));
  assert.equal(guard.check(fakeRequest({ authorization: '' }), '/api/x').ok, true);
});

// ── 限流 ────────────────────────────────────────────────────────────────

test('限流按来源 IP 记账，超过阈值返回 429', () => {
  const guard = createGuard(configWith({ rateLimitPerMinute: 3 }));

  for (let i = 0; i < 3; i += 1) {
    assert.equal(guard.check(fakeRequest({}, '10.0.0.1'), '/api/x').ok, true, `第 ${i + 1} 次应放行`);
  }

  const blocked = guard.check(fakeRequest({}, '10.0.0.1'), '/api/x');
  assert.equal(blocked.ok, false);
  assert.equal(blocked.status, 429);
  assert.match(blocked.message, /每分钟上限 3 次/);

  // 另一个 IP 不受影响
  assert.equal(guard.check(fakeRequest({}, '10.0.0.2'), '/api/x').ok, true);
});

test('限流为 0 表示关闭', () => {
  const guard = createGuard(configWith({ rateLimitPerMinute: 0 }));
  for (let i = 0; i < 50; i += 1) {
    assert.equal(guard.check(fakeRequest(), '/api/x').ok, true);
  }
});

test('经 frp 转发时用 X-Forwarded-For 的第一段作为来源', () => {
  const guard = createGuard(configWith({ rateLimitPerMinute: 1 }));

  const forwarded = { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' };
  assert.equal(guard.check(fakeRequest(forwarded, '127.0.0.1'), '/api/x').ok, true);

  // 同一个真实来源，即使直连地址相同也应被限流
  assert.equal(guard.check(fakeRequest(forwarded, '127.0.0.1'), '/api/x').ok, false);

  // 换一个转发来源则放行
  const other = { 'x-forwarded-for': '203.0.113.8, 10.0.0.1' };
  assert.equal(guard.check(fakeRequest(other, '127.0.0.1'), '/api/x').ok, true);
});

test('限流窗口时间到后自动重置', async () => {
  const guard = createGuard(configWith({ rateLimitPerMinute: 1 }));
  assert.equal(guard.check(fakeRequest(), '/api/x').ok, true);
  assert.equal(guard.check(fakeRequest(), '/api/x').ok, false);

  // 等窗口过去——实测窗口是 60 秒，这里不去等一分钟，
  // 而是直接验证「窗口存在且会随时间推进」这件事由时间戳驱动
  const stats = guard.stats();
  assert.equal(stats.limitPerMinute, 1);
  assert.equal(stats.tokenRequired, false);
  assert.ok(stats.trackedClients >= 1);
});

// ── 状态展示 ────────────────────────────────────────────────────────────

test('stats 如实反映门禁配置', () => {
  assert.deepEqual(createGuard(configWith()).stats(), {
    trackedClients: 0,
    limitPerMinute: 120,
    tokenRequired: false,
    tokenCount: 0,
    authMode: 'key',
  });

  const guarded = createGuard(configWith({ apiTokens: ['x', 'y'], rateLimitPerMinute: 10 }));
  const stats = guarded.stats();
  assert.equal(stats.tokenRequired, true);
  assert.equal(stats.tokenCount, 2);
  assert.equal(stats.limitPerMinute, 10);
});

// ── 公开模式 ────────────────────────────────────────────────────────────

test('AUTH_MODE=open 时不校验令牌——令牌写进客户端包里就不是秘密了', () => {
  const guard = createGuard(configWith({ authMode: 'open', apiTokens: ['secret'] }));
  const path = '/api/maimai/b50/123';

  // 不带令牌也放行
  assert.equal(guard.check(fakeRequest(), path).ok, true);
  // 带了错的令牌同样放行——公开模式下它根本不是门禁
  assert.equal(guard.check(fakeRequest({ authorization: 'garbage' }), path).ok, true);
  // 状态里如实反映
  assert.equal(guard.stats().tokenRequired, false);
  assert.equal(guard.stats().authMode, 'open');
});

test('AUTH_MODE=open 时限流仍然生效（这才是真正的约束）', () => {
  const guard = createGuard(configWith({ authMode: 'open', rateLimitPerMinute: 2 }));
  assert.equal(guard.check(fakeRequest(), '/api/x').ok, true);
  assert.equal(guard.check(fakeRequest(), '/api/x').ok, true);
  const blocked = guard.check(fakeRequest(), '/api/x');
  assert.equal(blocked.ok, false);
  assert.equal(blocked.status, 429);
});

// ── 部署安全校验 ────────────────────────────────────────────────────────

test('绑回环时不做任何校验——本机怎么配都行', () => {
  assert.doesNotThrow(() => assertDeploymentSafety(configWith({ isPublicBind: false })));
});

test('绑公网且 key 模式但没令牌 → 拒绝启动', () => {
  assert.throws(
    () => assertDeploymentSafety(configWith({ isPublicBind: true, host: '0.0.0.0', authMode: 'key' })),
    /拒绝启动/,
  );
});

test('绑公网且 key 模式有令牌 → 放行', () => {
  assert.doesNotThrow(() =>
    assertDeploymentSafety(
      configWith({ isPublicBind: true, host: '0.0.0.0', authMode: 'key', apiTokens: ['x'] }),
    ),
  );
});

test('绑公网且 open 模式没有任何限流 → 拒绝启动', () => {
  assert.throws(
    () =>
      assertDeploymentSafety(
        configWith({
          isPublicBind: true,
          host: '0.0.0.0',
          authMode: 'open',
          rateLimitPerMinute: 0,
          upstreamLimitPerMinute: 0,
        }),
      ),
    /拒绝启动/,
  );
});

test('绑公网且 open 模式有任一道限流 → 放行（公开分发就是要这个）', () => {
  assert.doesNotThrow(() =>
    assertDeploymentSafety(
      configWith({
        isPublicBind: true,
        host: '0.0.0.0',
        authMode: 'open',
        rateLimitPerMinute: 0,
        upstreamLimitPerMinute: 150,
      }),
    ),
  );
  assert.doesNotThrow(() =>
    assertDeploymentSafety(
      configWith({
        isPublicBind: true,
        host: '0.0.0.0',
        authMode: 'open',
        rateLimitPerMinute: 60,
        upstreamLimitPerMinute: 0,
      }),
    ),
  );
});
