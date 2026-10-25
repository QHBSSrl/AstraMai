/**
 * 把网桥包装成 `fetch`。
 *
 * ── 为什么需要这一层 ────────────────────────────────────────────────
 *
 * `bridge.js` 提供的是**应用层**的 `request(action, options)` ——
 * 它只知道 `ping` 和 `b50` 两种动作，不理解 HTTP。
 *
 * 而 `LxnsClient` / `sync-client` 这些上层模块用的是标准的 `fetchImpl`。
 * 要让它俩跑在手环上，中间得有一层翻译：
 *
 *     fetch('/api/v1/maimai/b50/xxx')
 *          ↓  本文件
 *     bridge.request('http', { method, path, body, headers })
 *          ↓  插件
 *     服务器
 *
 * ── 插件的约定（两边必须一致）──────────────────────────────────────
 *
 * 请求：
 *   { id, action: 'http', method: 'GET', path: '/api/v1/...', body?: string,
 *     headers?: { ... }, timeoutMs?: number }
 *
 * 响应：
 *   { id, ok: true, status: 200, body: '<原始响应文本>' }
 *   { id, ok: false, status: 0, error: '原因' }
 *
 * `path` 是**相对服务器根**的，插件自己拼 `SERVER_BASE`。
 * 这样密钥和服务器地址都不会出现在手表上。
 *
 * ── 为什么不在手表上拼完整 URL ────────────────────────────────────
 *
 * 手表上确实有服务器地址（用户可以在设置里改），但：
 *   · 插件已经知道地址了，让手表再传一遍没意义
 *   · 手环的蓝牙带宽很窄，能少传一个字段是一个
 *   · 换服务器时只要改插件一处
 *
 * 所以这里只传 `path`。**这是一个有意的取舍**，不是漏了。
 */

import * as bridge from './bridge.js';

/** 插件默认的超时，和 `bridge.js` 的 25 秒对齐。 */
const DEFAULT_TIMEOUT_MS = 25000;

/**
 * 有没有可用的网桥。
 *
 * `false` 时调用方应该直接报「手环需要装网桥插件」，
 * 而不是走一遍 25 秒超时再失败。
 */
export function isBridgeFetchAvailable() {
  return bridge.isAvailable();
}

/**
 * 造一个 `fetchImpl`。
 *
 * 返回的对象尽量贴近标准 `Response` 的最小可用子集：
 * `{ ok, status, text(), json() }` ——
 * 上层（`LxnsClient` 的 request 封装）只用得到这些。
 */
export function createBridgeFetch() {
  return function bridgeFetch(path, init = {}) {
    return new Promise((resolve, reject) => {
      const method = String(init.method || 'GET').toUpperCase();

      /*
       * body 统一转成字符串。上层的 request 封装传进来的可能是
       * 对象、字符串或者 undefined —— 插件那边只认字符串。
       */
      let body;
      if (init.body !== undefined && init.body !== null) {
        body = typeof init.body === 'string' ? init.body : JSON.stringify(init.body);
      }

      const options = {
        method,
        path: normalizePath(path),
        ...(body !== undefined ? { body } : {}),
        ...(init.headers && typeof init.headers === 'object' ? { headers: init.headers } : {}),
        timeoutMs: DEFAULT_TIMEOUT_MS,
      };

      bridge.request('http', options).then(
        (data) => {
          if (!data || data.ok !== true) {
            const reason =
              (data && (data.error || data.message)) || '网桥没有返回结果';
            reject(new Error(`网桥请求失败：${reason}`));
            return;
          }

          const status = Number(data.status) || 0;
          const text = typeof data.body === 'string' ? data.body : '';

          resolve({
            ok: status >= 200 && status < 300,
            status,
            text: () => Promise.resolve(text),
            json: () => Promise.resolve(JSON.parse(text)),
          });
        },
        (error) => {
          reject(error instanceof Error ? error : new Error(String(error)));
        },
      );
    });
  };
}

/**
 * 把各种形态的地址归一成「相对服务器根」的路径。
 *
 * 上层传进来的可能是：
 *   · `/api/v1/...`                     → 原样
 *   · `https://host/api/v1/...`         → 只留 path
 *   · `http://host:8787/api/v1/...`     → 只留 path
 *   · `api/v1/...`（缺前导斜杠）         → 补上
 */
function normalizePath(input) {
  const raw = String(input || '');

  // 完整 URL：抠出 path + query
  const absolute = /^https?:\/\/[^/]+(\/.*)?$/i.exec(raw);
  if (absolute) {
    const rest = absolute[1] || '/';
    return rest.startsWith('/') ? rest : `/${rest}`;
  }

  if (!raw) return '/';
  return raw.startsWith('/') ? raw : `/${raw}`;
}
