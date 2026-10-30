/**
 * 网桥 → 标准 `fetch`。
 *
 * ── 它解决什么 ──────────────────────────────────────────────────────
 *
 * 手环没有 `@system.fetch`，只有蓝牙（`@system.interconnect`）。
 * 手机上的 AstroBox 装了官方的「网桥 FetchBridge」插件之后，
 * 手环就能通过手机上网。
 *
 * 中间要一层翻译，因为上层（`LxnsClient` / `sync-client`）用的是标准
 * `fetchImpl`，而网桥说的是它自己的 JSON 协议：
 *
 *     fetch('/api/v1/maimai/b50/compact?code=xxx')
 *          ↓  本文件
 *     FetchBridge 协议 { tag:'fetch', id, url, options }
 *          ↓  手机上的插件
 *     https://... 真实服务器
 *
 * ── 两种模式，用户可选 ──────────────────────────────────────────────
 *
 *   'single'  单消息。快、简单，但响应不能超过 **16 KB**
 *             （插件里的 `MAX_UNCHUNKED_WIRE_LEN`）。
 *             配合服务端的 `/compact` 端点（B50 约 12 KB）正好。
 *
 *   'stream'  v4 开放长度流。分片 + 逐帧 CRC32 + 累计 ACK 流控，
 *             没有长度限制，但要处理重传和乱序。
 *             想看完整数据（封面清晰度、别名、物量）时用。
 *
 * 这个取舍是**用户可感知**的，所以做成了设置项而不是写死。
 *
 * ── 为什么不用自己写的插件 ──────────────────────────────────────────
 *
 * 我们自己写过一版（Python + `browser.open` + `eval` 跑 XHR），能跑，
 * 但**每次都会弹一个浏览器窗口**，还要用户点授权。
 *
 * 官方插件直接用 `wasi:http`（Rust 的 `waki` crate）发请求 ——
 * 没有浏览器、没有弹窗。而且它已经解决了分片死锁（v3 的累计 ACK +
 * 滑动窗口），那是我们自己写一定会踩的坑。
 */

import { MODE, createFetchBridge } from './fetchbridge.js';
import { getServerBase } from './config.js';
import { readSetting } from './store.js';

/** 默认模式。单消息更快，先用它。 */
export const DEFAULT_BRIDGE_MODE = MODE.SINGLE;

/** 设置里存的键。 */
export const BRIDGE_MODE_KEY = 'bridgeMode';

/**
 * 有没有可用的网桥。
 *
 * 判据是「能不能拿到 `@system.interconnect`」—— 手环有，手表不一定有。
 * 拿得到不代表插件装了，但**拿不到就一定没戏**，足够挡掉大部分误报。
 *
 * 注意这里是**同步**判断，不握手。真正的可用性要发请求才知道。
 */
/**
 * 有没有可用的网桥。
 *
 * ── 为什么必须缓存 ⚠️ ────────────────────────────────────────────────
 *
 * 这个函数会被 `getClient()` / `activeTransport()` / `requestWithFallback()`
 * 反复调用。而它内部要 `require('@system.interconnect')` 再 `instance()`。
 *
 * **`instance()` 每次调用都可能创建一个新的原生连接对象。**
 * 之前没缓存的时候，一次查询能触发七八次，长时间用下来就是内存持续增长 ——
 * 用户反馈的「手表容易死机黑屏」很可能就是它。
 *
 * 所以结果只算一次。`@system.interconnect` 在应用生命周期内不会变，
 * 缓存是安全的。真要重置就调 `resetBridgeAvailability()`。
 */
let bridgeAvailability = null;

export function isBridgeFetchAvailable() {
  if (bridgeAvailability !== null) return bridgeAvailability;

  try {
    // eslint-disable-next-line global-require
    const interconnect = require('@system.interconnect');
    if (!interconnect || typeof interconnect.instance !== 'function') {
      bridgeAvailability = false;
      return false;
    }
    const instance = interconnect.instance();
    bridgeAvailability = Boolean(instance);
    return bridgeAvailability;
  } catch (error) {
    bridgeAvailability = false;
    return false;
  }
}

/** 清掉缓存（切换设备 / 重新检测时用）。 */
export function resetBridgeAvailability() {
  bridgeAvailability = null;
}

/**
 * 造一个 `fetchImpl`。
 *
 * 返回的对象尽量贴近标准 `Response` 的最小可用子集：
 * `{ ok, status, text(), json() }` —— 上层只用得到这些。
 *
 * @param {object} [options]
 * @param {'single'|'stream'} [options.mode] 传输方式；不传就读设置
 */
/**
 * 单例缓存。
 *
 * ⚠️ **必须缓存。** 之前每次 `createBridgeFetch()` 都新建一个
 * `createFetchBridge()`，而它内部会拿一个 `@system.interconnect` 实例、
 * 挂 `onmessage` 回调。
 *
 * `api.js` 的 `getClient()` 在网络失败时会 `cachedClient = null` 重建，
 * 于是每失败一次就新拉一个原生连接 —— 旧的那个还挂着回调不释放。
 * 这就是「手表容易死机黑屏」的头号嫌疑。
 *
 * 同一个 mode 永远复用同一个 client。
 */
let cachedClient = null;
let cachedMode = null;

export function createBridgeFetch(options = {}) {
  const mode =
    options.mode === MODE.STREAM || options.mode === MODE.SINGLE
      ? options.mode
      : readBridgeMode();

  if (cachedClient && cachedMode === mode) {
    return cachedClient;
  }

  const bridgeClient = createFetchBridge({
    mode,
    getInterconnect: () => {
      // eslint-disable-next-line global-require
      const interconnect = require('@system.interconnect');
      return interconnect.instance();
    },
  });

  const fetchImpl = function bridgeFetch(path, init = {}) {
    const url = toAbsoluteUrl(path);

    return bridgeClient.request(url, init).then((response) => ({
      ok: response.ok,
      status: response.status,
      text: () => Promise.resolve(response.text),
      json: () => Promise.resolve(JSON.parse(response.text)),
    }));
  };

  cachedClient = fetchImpl;
  cachedMode = mode;
  return fetchImpl;
}

/** 清掉单例（换模式 / 重新检测时用）。 */
export function resetBridgeFetch() {
  cachedClient = null;
  cachedMode = null;
}

/**
 * 拼成完整 URL。
 *
 * `FetchBridge` 的协议要求 `url` 是**绝对地址**（它不像我们自己写的插件
 * 那样可以自己拼基址），所以这里要把相对路径补成完整的。
 *
 * 基址和 `api.js` 用的是同一个 `config.js`，换服务器时不需要改两处。
 */
function toAbsoluteUrl(input) {
  const raw = String(input || '');

  // 已经是绝对地址
  if (/^https?:\/\//i.test(raw)) return raw;

  const base = String(getServerBase() || '').replace(/\/+$/, '');
  const path = raw.startsWith('/') ? raw : `/${raw}`;
  return base + path;
}

/** 读设置里的模式（设置了就用设置，否则用默认）。 */
export function readBridgeMode() {
  try {
    const stored = String(readSetting(BRIDGE_MODE_KEY, '') || '');
    return stored === MODE.STREAM ? MODE.STREAM : DEFAULT_BRIDGE_MODE;
  } catch (error) {
    return DEFAULT_BRIDGE_MODE;
  }
}
