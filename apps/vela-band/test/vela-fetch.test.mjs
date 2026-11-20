/**
 * `createVelaFetch` 的单元测试。
 *
 * 为什么值得测：`@system.fetch` 与 Web 的 `fetch` 语义差别不小
 * （回调式、非 2xx 也走 success、没有 Response.text()），
 * 这些差异如果搞错，表现是「网络看着通了但数据是错的」，在手表上极难排查。
 *
 * 把 fetch 模块参数化之后，这个文件就是纯函数，可以在 Node 里穷举这些分支。
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createVelaFetch } from '../src/common/vela-fetch.js';

/** 造一个假的 @system.fetch 模块。 */
function fakeModule(handler) {
  return {
    fetch(options) {
      return handler(options);
    },
  };
}

test('缺少 fetch() 的模块应当直接报错', () => {
  assert.throws(() => createVelaFetch(null), TypeError);
  assert.throws(() => createVelaFetch({}), TypeError);
  assert.throws(() => createVelaFetch({ fetch: 'nope' }), TypeError);
});

test('字符串响应体原样返回', async () => {
  const adapter = createVelaFetch(
    fakeModule((options) => {
      options.success({ code: 200, data: '{"a":1}', headers: {} });
    }),
  );

  const response = await adapter('https://example.com/x');
  assert.equal(response.ok, true);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), '{"a":1}');
});

test('对象响应体转成 JSON 字符串（core 只会自己解析文本）', async () => {
  const adapter = createVelaFetch(
    fakeModule((options) => {
      options.success({ code: 200, data: { a: 1 }, headers: {} });
    }),
  );

  const response = await adapter('https://example.com/x');
  assert.equal(await response.text(), '{"a":1}');
});

test('非 2xx 必须判为失败——Vela 对 4xx/5xx 也走 success', async () => {
  for (const code of [301, 400, 401, 403, 404, 429, 500, 502]) {
    const adapter = createVelaFetch(
      fakeModule((options) => {
        options.success({ code, data: '{"success":false}', headers: {} });
      }),
    );
    const response = await adapter('https://example.com/x');
    assert.equal(response.ok, false, `code ${code} 应判为失败`);
    assert.equal(response.status, code);
  }

  const okAdapter = createVelaFetch(
    fakeModule((options) => {
      options.success({ code: 204, data: '', headers: {} });
    }),
  );
  assert.equal((await okAdapter('https://example.com/x')).ok, true);
});

test('fail 回调转成 reject，并带上错误码', async () => {
  const adapter = createVelaFetch(
    fakeModule((options) => {
      options.fail({ errMsg: '无法解析域名' }, 1001);
    }),
  );

  await assert.rejects(
    () => adapter('https://example.com/x'),
    (error) => {
      assert.match(error.message, /无法解析域名/);
      assert.match(error.message, /1001/);
      assert.equal(error.velaCode, 1001);
      return true;
    },
  );
});

test('fail 只给字符串时也能构造出可读错误', async () => {
  const adapter = createVelaFetch(
    fakeModule((options) => {
      options.fail('boom', 500);
    }),
  );
  await assert.rejects(() => adapter('https://example.com/x'), /boom/);
});

test('超时应当 reject 而不是一直挂着', async () => {
  const adapter = createVelaFetch(
    // 故意什么都不回调，模拟请求卡死
    fakeModule(() => {}),
    { timeoutMs: 30 },
  );

  await assert.rejects(() => adapter('https://example.com/slow'), /请求超时/);
});

test('超时之后迟到的 success 不应再改变结果', async () => {
  let captured;
  const adapter = createVelaFetch(
    fakeModule((options) => {
      captured = options;
    }),
    { timeoutMs: 20 },
  );

  const promise = adapter('https://example.com/late');
  await assert.rejects(() => promise, /请求超时/);

  // 超时后才回来：不应抛未处理的异常，也不应二次 settle
  captured.success({ code: 200, data: 'late', headers: {} });
  captured.fail({ errMsg: 'late fail' }, 1);
});

test('success 与 fail 都触发时只认第一个', async () => {
  const adapter = createVelaFetch(
    fakeModule((options) => {
      options.success({ code: 200, data: 'first', headers: {} });
      options.fail({ errMsg: 'second' }, 1);
    }),
  );

  const response = await adapter('https://example.com/race');
  assert.equal(await response.text(), 'first');
});

test('fetch() 同步抛错时转成 reject', async () => {
  const adapter = createVelaFetch(
    fakeModule(() => {
      throw new Error('内部错误');
    }),
  );
  await assert.rejects(() => adapter('https://example.com/x'), /内部错误/);
});

test('method 与 header 透传给底层', async () => {
  let seen = null;
  const adapter = createVelaFetch(
    fakeModule((options) => {
      seen = options;
      options.success({ code: 200, data: '{}', headers: {} });
    }),
  );

  await adapter('/api/maimai/b50/123', { method: 'POST', headers: { accept: 'application/json' } });
  assert.equal(seen.url, '/api/maimai/b50/123');
  assert.equal(seen.method, 'POST');
  assert.deepEqual(seen.header, { accept: 'application/json' });
});

test('未传 init 时默认 GET，header 为空对象', async () => {
  let seen = null;
  const adapter = createVelaFetch(
    fakeModule((options) => {
      seen = options;
      options.success({ code: 200, data: '{}', headers: {} });
    }),
  );

  await adapter('/api/health');
  assert.equal(seen.method, 'GET');
  assert.deepEqual(seen.header, {});
});

test('data 为空或缺失时 text() 返回空串', async () => {
  for (const data of [undefined, null, '']) {
    const adapter = createVelaFetch(
      fakeModule((options) => {
        options.success({ code: 200, data, headers: {} });
      }),
    );
    const response = await adapter('/x');
    assert.equal(await response.text(), '');
  }
});
