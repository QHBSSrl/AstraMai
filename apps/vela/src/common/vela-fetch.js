/**
 * 把 Vela 的 `@system.fetch` 适配成 `@astramai/core` 需要的 `FetchLike`。
 *
 * 为什么单独一个文件、并且把 fetch 模块作为参数传进来：
 *   1. `@system.fetch` 只在手表运行时存在，Node 里 import 不到——参数化之后
 *      这个文件就是纯函数，可以在 Node 里对着假的 fetch 模块做单元测试；
 *   2. core 的 `LxnsClient` 本来就把 fetch 设计成可注入的，这里正好接上。
 *
 * Vela 的 fetch 与 Web 的 fetch 有几处关键差异，都在这里抹平：
 *   - 它是 `fetch.fetch({ url, method, header, success, fail })`，不是 `fetch(url, init)`
 *   - 它没有 `Response.text()`，数据直接在回调里
 *   - **HTTP 非 2xx 也会走 success**，必须自己看 `code` 判断成败
 *   - 它没有超时参数（Web 的 fetch 也没有，但浏览器有 AbortController 兜底）
 */

/**
 * @param {object} velaFetch  `@system.fetch` 模块
 * @param {{ timeoutMs?: number }} [options]
 * @returns {(url: string, init?: { method?: string, headers?: Record<string,string> }) => Promise<{ ok: boolean, status: number, text: () => Promise<string> }>}
 */
export function createVelaFetch(velaFetch, options = {}) {
  const timeoutMs = options.timeoutMs ?? 15000

  if (!velaFetch || typeof velaFetch.fetch !== 'function') {
    throw new TypeError('createVelaFetch 需要一个提供 fetch() 的模块');
  }

  return function velaFetchAdapter(url, init) {
    return new Promise((resolve, reject) => {
      let settled = false
      let timer = null

      const finish = (fn, value) => {
        if (settled) return
        settled = true
        if (timer !== null) clearTimeout(timer)
        fn(value)
      }

      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          finish(reject, new Error(`请求超时（${timeoutMs}ms）：${url}`))
        }, timeoutMs)
      }

      try {
        velaFetch.fetch({
          url,
          method: (init && init.method) || 'GET',
          header: (init && init.headers) || {},
          // 不传 responseType：让 Vela 按 Content-Type 决定，
          // 我们在下面统一转成字符串交给 core 自己解析。
          success(response) {
            const code = typeof response.code === 'number' ? response.code : 0
            const body = response.data
            const text =
              typeof body === 'string'
                ? body
                : body === undefined || body === null
                  ? ''
                  : JSON.stringify(body)

            finish(resolve, {
              // 关键：Vela 对非 2xx 也走 success
              ok: code >= 200 && code < 300,
              status: code,
              text: () => Promise.resolve(text),
            })
          },
          fail(data, code) {
            const message =
              (data && (data.errMsg || data.message)) || data || '网络请求失败'
            const error = new Error(`${message}（code ${code}）`)
            error.velaCode = code
            finish(reject, error)
          },
        })
      } catch (error) {
        finish(reject, error)
      }
    })
  }
}
