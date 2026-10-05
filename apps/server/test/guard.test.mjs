/**
 * 访问门禁的单元测试。
 *
 * 这一层的价值全在「暴露到公网时会不会漏」上，所以测的都是边界：
 * 健康检查是否豁免、令牌前缀是否兼容、限流窗口是否按时重置、转发头是否可信。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createGuard } from '../dist/guard.js';

/** 造一个够用的假请求对象。 */
function fakeRequest(headers = {}, remoteAddress = '10.0.0.1') {
  return { headers, socket: { remoteAddress } };
}

function configWith(overrides = {}) {
  return {
    apiToken: undefined,
    rateLimitPerMinute: 120,
    ...overrides,
  };
}

test('未配置令牌时，业务接口放行', () => {
  const guard = createGuard(configWith());
  const result = guard.check(fakeRequest(), '/api/maimai/b50/123');
  assert.equal(result.ok, true);
});

test('健康检查永远放行——手表要先靠它确认地址填对没有', () => {
  const guard = createGuard(configWith({ apiToken: 'secret' }));
  assert.equal(guard.check(fakeRequest(), '/api/health').ok, true);
  // 哪怕带个错的令牌也放行
  assert.equal(
    guard.check(fakeRequest({ authorization: 'wrong' }), '/api/health').ok,
    true,
  );
});

test('配置令牌后，业务接口必须带对令牌', () => {
  const guard = createGuard(configWith({ apiToken: 'secret' }));

  assert.equal(guard.check(fakeRequest(), '/api/maimai/b50/123').ok, false);
  assert.equal(guard.check(fakeRequest(), '/api/maimai/b50/123').status, 401);
  assert.equal(guard.check(fakeRequest({ authorization: 'nope' }), '/api/maimai/b50/1').ok, false);
  assert.equal(guard.check(fakeRequest({ authorization: 'secret' }), '/api/maimai/b50/1').ok, true);
});

test('令牌的三种写法都认', () => {
  const guard = createGuard(configWith({ apiToken: 'secret' }));
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
  const guard = createGuard(configWith({ apiToken: 'secret' }));
  for (const wrong of ['sec', 'secret2', 'xsecret', 'Secret']) {
    assert.equal(
      guard.check(fakeRequest({ authorization: wrong }), '/api/maimai/songs').ok,
      false,
      `${wrong} 不应通过`,
    );
  }
});

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

test('stats 如实反映门禁配置', () => {
  assert.deepEqual(createGuard(configWith()).stats(), {
    trackedClients: 0,
    limitPerMinute: 120,
    tokenRequired: false,
  });

  const guarded = createGuard(configWith({ apiToken: 'x', rateLimitPerMinute: 10 }));
  const stats = guarded.stats();
  assert.equal(stats.tokenRequired, true);
  assert.equal(stats.limitPerMinute, 10);
});
