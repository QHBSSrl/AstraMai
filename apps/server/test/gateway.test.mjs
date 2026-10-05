/**
 * 网关服务的单元测试。
 *
 * 重点在**降级策略**上：曲库拉不到时回退到内置合成数据是设计好的，
 * 但降级必须只针对「上游不可用」。如果把「源名拼错」「密钥无效」这类
 * 调用方/配置问题也一起降级，客户端就会拿到一份看起来正常的假曲库——
 * 这种静默的错误答案比直接报错危险得多。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { LxnsError } from '@astramai/core';

import { GatewayService } from '../dist/gateway.js';
import { SourceRegistry } from '../dist/sources/registry.js';

function configWith(overrides = {}) {
  return {
    apiKey: 'test-key',
    songCacheTtlMs: 60_000,
    upstreamLimitPerMinute: 150,
    allowClientKey: false,
    modeConfig: 'live',
    ...overrides,
  };
}

/** 一个可编程的数据源：fetchLibrary 的行为由传入的函数决定。 */
function fakeSource(id, fetchLibrary) {
  return {
    id,
    label: id,
    games: ['maimai'],
    describe: () => ({ id, label: id, games: ['maimai'], requiresKey: false, available: true }),
    supports: () => true,
    getPlayer: async () => {
      throw new Error('unused');
    },
    getBests: async () => {
      throw new Error('unused');
    },
    fetchLibrary,
  };
}

const goodLibrary = () => ({
  songs: { songs: [], genres: [], versions: [] },
  aliases: { aliases: [] },
});

// ── 正常的曲库 ──────────────────────────────────────────────────────────

test('取到曲库时标记来源为 lxns', async () => {
  const registry = new SourceRegistry(150);
  registry.register(fakeSource('ok', async () => goodLibrary()), true);
  const gateway = new GatewayService(configWith(), registry);

  const library = await gateway.getLibrary('ok');
  assert.equal(library.source, 'lxns');
  assert.equal(gateway.cacheStatus().cached, true);
});

test('缓存生效：第二次不再调用数据源', async () => {
  const registry = new SourceRegistry(150);
  let calls = 0;
  registry.register(
    fakeSource('counting', async () => {
      calls += 1;
      return goodLibrary();
    }),
    true,
  );
  const gateway = new GatewayService(configWith(), registry);

  await gateway.getLibrary('counting');
  await gateway.getLibrary('counting');
  assert.equal(calls, 1, '第二次应当命中缓存');
});

// ── 降级：只有上游不可用才降级 ──────────────────────────────────────────

test('上游网络故障 → 降级为合成曲库（这是设计好的）', async () => {
  const registry = new SourceRegistry(150);
  registry.register(
    fakeSource('down', async () => {
      throw new LxnsError('network', '连不上上游');
    }),
    true,
  );
  const gateway = new GatewayService(configWith(), registry);

  const library = await gateway.getLibrary('down');
  assert.equal(library.source, 'synthetic');
});

test('上游超时 / 5xx → 同样降级', async () => {
  for (const kind of ['timeout', 'server', 'malformed']) {
    const registry = new SourceRegistry(150);
    registry.register(
      fakeSource('flakey', async () => {
        throw new LxnsError(kind, '上游抽风');
      }),
      true,
    );
    const gateway = new GatewayService(configWith(), registry);
    const library = await gateway.getLibrary('flakey');
    assert.equal(library.source, 'synthetic', `${kind} 应当降级`);
  }
});

test('源名不存在 → 原样抛错，绝不能降级成假数据', async () => {
  const registry = new SourceRegistry(150);
  registry.register(fakeSource('real', async () => goodLibrary()), true);
  const gateway = new GatewayService(configWith(), registry);

  await assert.rejects(
    () => gateway.getLibrary('nope'),
    (error) => {
      assert.ok(error instanceof LxnsError);
      assert.equal(error.kind, 'bad-request');
      return true;
    },
  );
});

test('密钥无效 / 权限不足 / 配额用尽 → 原样抛错，不降级', async () => {
  for (const kind of ['unauthorized', 'forbidden', 'rate-limited', 'not-found']) {
    const registry = new SourceRegistry(150);
    registry.register(
      fakeSource('authish', async () => {
        throw new LxnsError(kind, '不是上游故障');
      }),
      true,
    );
    const gateway = new GatewayService(configWith(), registry);

    await assert.rejects(
      () => gateway.getLibrary('authish'),
      (error) => {
        assert.equal(error.kind, kind, `${kind} 不应被降级`);
        return true;
      },
    );
  }
});

test('缓存过期但上游挂了时，用旧数据而不是合成假数据', async () => {
  const registry = new SourceRegistry(150);
  let mode = 'ok';
  registry.register(
    fakeSource('flappy', async () => {
      if (mode === 'ok') return goodLibrary();
      throw new LxnsError('network', '挂了');
    }),
    true,
  );
  // TTL 设为 0，强制每次都真的去取上游，这样才能走到失败分支
  const gateway = new GatewayService(configWith({ songCacheTtlMs: 0 }), registry);

  const first = await gateway.getLibrary('flappy');
  assert.equal(first.source, 'lxns');

  mode = 'down';
  const second = await gateway.getLibrary('flappy');
  // 手里有旧数据就必须接着用旧的——过期也比换成一份假的好
  assert.equal(second.source, 'lxns', '不该退回合成数据');
});

// ── 源的选择 ────────────────────────────────────────────────────────────

test('不传 sourceId 时用默认源', async () => {
  const registry = new SourceRegistry(150);
  registry.register(fakeSource('first', async () => goodLibrary()));
  registry.register(fakeSource('second', async () => goodLibrary()));
  assert.equal(registry.defaultSourceId(), 'first');

  const gateway = new GatewayService(configWith(), registry);
  const library = await gateway.getLibrary(registry.defaultSourceId());
  assert.equal(library.source, 'lxns');
});

test('setDefault 认不出的 id 会抛错，而不是偷偷用默认源', () => {
  const registry = new SourceRegistry(150);
  registry.register(fakeSource('real', async () => goodLibrary()));
  assert.throws(() => registry.setDefault('typo'), /未注册/);
});

test('list 会列出不可用的源并说明原因', () => {
  const registry = new SourceRegistry(150);
  registry.register({
    ...fakeSource('broken', async () => goodLibrary()),
    describe: () => ({
      id: 'broken',
      label: '坏掉的源',
      games: ['maimai'],
      requiresKey: true,
      available: false,
      unavailableReason: '服务端未配置密钥',
    }),
  });

  const list = registry.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].available, false);
  assert.match(list[0].unavailableReason, /未配置密钥/);
});

test('每个源各有独立的上游预算', () => {
  const registry = new SourceRegistry(2);
  registry.register(fakeSource('a', async () => goodLibrary()));
  registry.register(fakeSource('b', async () => goodLibrary()));

  const la = registry.limiterFor('a');
  const lb = registry.limiterFor('b');
  la.spend(2, 'A');
  // a 用满了不影响 b
  assert.equal(la.status().remaining, 0);
  assert.equal(lb.status().remaining, 2);
  assert.throws(() => la.spend(1, 'A'), /达每分钟 2 次上限/);
});
