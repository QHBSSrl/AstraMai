/**
 * 网络请求。
 *
 * 把 Vela 的 `@system.fetch` 接到 `@astramai/core` 的 `LxnsClient` 上。
 *
 * **开发者密钥不放这里。** 手表是端侧设备，密钥由服务端持有；
 * 端上只请求我们自己服务端的聚合接口。
 *
 * `@system.fetch` 用延迟 require 而不是顶层 import：
 * 静态 import 会在页面模块初始化时立刻解析平台模块，一旦设备/模拟器不提供它，
 * **整个页面脚本初始化就会抛错，页面直接空白**，日志里还没有有用的报错。
 */

import { LxnsClient } from './astramai-core.js';
import { getApiToken, getServerBase } from './config.js';
import { createBridgeFetch, isBridgeFetchAvailable } from './bridge-fetch.js';
import { createVelaFetch } from './vela-fetch.js';

export { DEFAULT_SERVER_BASE, getApiToken, getServerBase } from './config.js';

let fetchModule;
  /**
   * 取 `@system.fetch` 模块。
   *
   * ⚠️ **这里判的不只是「模块在不在」，还有「它到底能不能用」。**
   *
   * 之前的写法是 `require('@system.fetch') || null` —— 假设了
   * 「手环上没有这个模块，require 会抛错」。但这个假设**没验证过**。
   *
   * 实际情况可能是三种：
   *   ① require 抛错            → 模块真没有（我们原来只处理了这种）
   *   ② require 成功但返回空     → `|| null` 能兜住
   *   ③ require 成功、对象也在，但 `fetch` 不是函数 →
   *      原来会把一个坏对象当成可用，所有请求都失败，
   *      而且**永远不会降到网桥** —— 表现就是「手环上连不上网」
   *
   * 第 ③ 种最坑：它不抛错，只是每次请求都失败。用户看到「网络不太好」，
   * 而实际上网桥根本没被用上。
   *
   * 所以这里额外检查 `typeof loaded.fetch === 'function'`。
   */
  function getFetchModule() {
    if (fetchModule !== undefined) return fetchModule;

    try {
      // eslint-disable-next-line global-require
      const loaded = require('@system.fetch');
      if (loaded && typeof loaded.fetch === 'function') {
        fetchModule = loaded;
      } else {
        console.warn('[AstraMai] @system.fetch 存在但 fetch 不是函数，按无网络处理');
        fetchModule = null;
      }
    } catch (error) {
      console.warn('[AstraMai] @system.fetch 不可用：', error);
      fetchModule = null;
    }

    return fetchModule;
  }

  /**
   * 运行时探测结果 —— **实际发过一次请求并且失败了**。
   *
   * 和 `getFetchModule()` 的区别：
   *   · `getFetchModule()` 看的是「模块长什么样」
   *   · 这个看的是「实际用起来行不行」
   *
   * 有些设备 `@system.fetch` 对象齐全、`fetch` 也是函数，但一调用就 fail
   * （手环上没网络栈，只是把 API 挂着）。那种情况只有真发一次才知道。
   *
   * 一旦失败过就**永久**改走网桥 —— 不要每次请求都先失败一次。
   */
  let nativeFetchBroken = false;

  /** 标记原生 fetch 已经坏掉，之后一律走网桥。 */
  export function markNativeFetchBroken() {
    if (nativeFetchBroken) return;
    console.warn('[AstraMai] 原生 fetch 实测失败，改走网桥');
    nativeFetchBroken = true;
    // 客户端要重建，否则还用着坏掉的那个 fetchImpl
    cachedClient = null;
  }

  /** 现在实际会走哪条路（给设置页 / 诊断用）。 */
  export function activeTransport() {
    if (getFetchModule() && !nativeFetchBroken) return 'direct';
    if (isBridgeFetchAvailable()) return 'bridge';
    return 'none';
  }

let cachedClient = null;
let cachedBase = null;
let cachedToken = null;

/** 取一个绑定到当前配置的客户端（地址或令牌变了会自动重建）。 */
export function getClient(base) {
  const target = base || getServerBase();
  const token = getApiToken();
  if (cachedClient && cachedBase === target && cachedToken === token) return cachedClient;

  /*
   * ⚠️ **手环走的是下面 `!systemFetch` 那个分支。**
   *
   * 小米手环没有 `@system.fetch` —— 它只有蓝牙（`@system.interconnect`），
   * 必须靠 AstroBox 网桥插件转发。所以顺序是：
   *
   *   1. 有 fetch   → 直接用（手表、模拟器）
   *   2. 没有 fetch → 用网桥（手环 + 手机上装了插件）
   *   3. 都没有     → 报一句人话，告诉他怎么修
   *
   * 第 2 步要先探活（`isBridgeFetchAvailable`），否则插件没装时，
   * 每次请求都要干等 25 秒超时才失败。
   */
  const systemFetch = getFetchModule();

  const usableFetch = systemFetch && !nativeFetchBroken ? systemFetch : null;

  if (!usableFetch && !isBridgeFetchAvailable()) {
    throw new Error(
      '这台设备不支持直接联网（手环没有网络模块）。'
        + '请在手机上的 AstroBox 里装 AstraMai 网桥插件（跟装这个 App 是同一个 App），'
        + '装好启用后，手环就能通过手机的蓝牙上网了。手表（Watch 系列）不受影响。',
    );
  }

  const velaFetch = systemFetch
    ? createVelaFetch(systemFetch, { timeoutMs: 12000 })
    : createBridgeFetch();
  cachedClient = new LxnsClient({
    baseUrl: target,
    fetchImpl: velaFetch,
    ...(token ? { extraHeaders: { 'x-api-key': token } } : {}),
  });
  cachedBase = target;
  cachedToken = token;
  return cachedClient;
}

/**
 * 拉取 B50 聚合结果。
 *
 * 服务端已经把玩家信息、曲库、Rating 对拍全部组装好了，端上拿到的就是
 * 可以直接渲染的视图模型——手表算力和流量都紧张，不适合端上拼装。
 */
/**
 * 现在是不是**只能走网桥**（设备没有原生 `fetch`）。
 *
 * 是的话就不该用完整 B50 —— 那样 88 KB 的数据要么被网桥的 16 KB 上限拒掉，
 * 要么得走 v4 分片 + ACK 那套重活。服务端有个瘦身端点（约 12 KB），
 * 只回手表真正显示的字段，用它就够。
 */
function needCompact() {
  return getFetchModule() === null || nativeFetchBroken;
}

/**
 * 发一次请求，**原生 fetch 失败时自动降级到网桥并重试一次**。
 *
 * ── 为什么需要这个 ────────────────────────────────────────────────
 *
 * `getFetchModule()` 只能判断「模块长什么样」，判断不了「实际能不能用」。
 *
 * 有些设备（手环就是这样）`@system.fetch` 对象齐全、`fetch` 也是函数，
 * 但**一调用就失败** —— 那个运行时里压根没有网络栈，API 只是挂着。
 *
 * 没有这层的话，用户看到的是「网络不太好」，而实际上网桥根本没被用上。
 *
 * 所以：第一次失败就记下来（`markNativeFetchBroken`），之后一律走网桥，
 * 并且**立刻用网桥重试这一次** —— 用户不该为了这个重新点一次查询。
 */
function requestWithFallback(run) {
  return run().catch((error) => {
    // 已经是网桥了，或者压根没有网桥 —— 没得降级
    if (!getFetchModule() || nativeFetchBroken) throw error;
    if (!isBridgeFetchAvailable()) throw error;

    markNativeFetchBroken();
    return run();
  });
}

export function fetchB50(friendCode) {
  return requestWithFallback(() => {
    if (needCompact()) {
      return getClient().request(
        `/api/v1/maimai/b50/compact?code=${encodeURIComponent(friendCode)}`,
      );
    }
    return getClient().request(`/api/maimai/b50/${friendCode}`);
  });
}

/** 按 QQ 号拉取 B50。 */
export function fetchB50ByQq(qq) {
  return requestWithFallback(() => {
    if (needCompact()) {
      return getClient().request(`/api/v1/maimai/b50/compact?qq=${encodeURIComponent(qq)}`);
    }
    return getClient().request(`/api/maimai/b50/qq/${qq}`);
  });
}

/**
 * 中二节奏成绩（B30 + Selection10 + Recent10）。
 *
 * ⚠️ 路径是 `bests` 而不是 `b50`：中二不是 B50 那个玩法，
 * 视图结构也不同（bests/selections/recents 三组并列，而不是 B35+B15）。
 * 复用舞萌的字段名会让调用方以为拿到的是同一种东西。
 */
export function fetchChunithmBests(friendCode) {
  return requestWithFallback(() =>
    getClient().request(`/api/v1/chunithm/bests?code=${friendCode}`),
  );
}

/** 中二节奏成绩，按 QQ 号。 */
export function fetchChunithmBestsByQq(qq) {
  return requestWithFallback(() =>
    getClient().request(`/api/v1/chunithm/bests?qq=${qq}`),
  );
}

/**
 * 曲目搜索。
 *
 * 服务端在曲名、艺术家和落雪别名三个维度上做匹配，
 * 因此端上可以直接输入日文曲名、中文别名或罗马音。
 */
export function searchSongs(keyword, limit = 30) {
  const query = encodeURIComponent(keyword);
  return getClient().request(`/api/maimai/search?q=${query}&limit=${limit}`);
}

/**
 * 中二节奏曲目搜索。
 *
 * 和舞萌命中同样的三个维度（曲名 / 艺术家 / 别名），
 * 但**难度结构不同**：中二是 6 档且物量是 air/flick。
 * 所以结果不能直接套舞萌的渲染逻辑。
 */
export function searchChunithmSongs(keyword, limit = 30) {
  const query = encodeURIComponent(keyword);
  return getClient().request(`/api/v1/chunithm/search?q=${query}&limit=${limit}`);
}

/**
 * 拉某游戏的乐曲分类列表。
 *
 * 单独一个接口、只回 7 个分类名：曲库有一千多首，
 * 为了几个分类名去拉整份曲库不值得。
 *
 * ⚠️ **中二的分类没有 title 字段**（实测），只有 `genre` 且本身已是中文；
 * 舞萌两个都有。调用方统一用 `title || genre`。
 */
export function fetchGenres(gameId) {
  return getClient().request(`/api/v1/${gameId}/genres`);
}

/**
 * 按分类浏览曲目。
 *
 * 走的是**同一个搜索接口**，所以返回形状与关键词搜索完全一致——
 * 渲染、分页、详情跳转都不用为「浏览」另写一套。
 */
export function searchByGenre(gameId, genreId, limit = 100) {
  return getClient().request(
    `/api/v1/${gameId}/search?genre=${encodeURIComponent(genreId)}&limit=${limit}`,
  );
}

/** 服务端健康检查，用来判断地址填对没有。 */
export function fetchHealth() {
  return getClient().request('/api/health');
}

/** 换地址或令牌后调用，清掉缓存。 */
export function resetClient() {
  cachedClient = null;
  cachedBase = null;
  cachedToken = null;
}

// ── 设备配对 ────────────────────────────────────────────────────────────
//
// 走裸 fetch 而不是 LxnsClient：这几个接口的响应形状和落雪信封不同
// （格式类错误是顶层 { ok:false, message }），用 core 的解析反而绕。

/**
 * 通用 JSON 请求封装（配对与 Phigros 共用）。
 *
 * 刻意走裸 fetch 而不是 LxnsClient：这些接口的响应形状和落雪信封不同
 * （格式类错误是顶层 { ok:false, message }，Phigros 则是 RFC 7807），
 * 用 core 的解析反而绕。
 */
let rawFetch = null;

  function getRawFetch() {
    if (rawFetch) return rawFetch;

    /*
     * 和 getClient 同一套顺序：
     *   1. 有 @system.fetch 且实测没坏 → 直接用
     *   2. 否则 → 走网桥（手环）
     *   3. 都没有 → 报一句人话
     */
    const systemFetch = getFetchModule();
    const usableFetch = systemFetch && !nativeFetchBroken ? systemFetch : null;

    if (!usableFetch && !isBridgeFetchAvailable()) {
      throw new Error(
        '这台设备不支持直接联网（手环没有网络模块）。'
          + '请在手机上的 AstroBox 里装 AstraMai 网桥插件（跟装这个 App 是同一个 App），'
          + '装好启用后，手环就能通过手机的蓝牙上网了。手表（Watch 系列）不受影响。',
      );
    }

    rawFetch = usableFetch
      ? createVelaFetch(usableFetch, { timeoutMs: 12000 })
      : createBridgeFetch();
    return rawFetch;
}

async function jsonRequest(path, init) {
  const response = await getRawFetch()(`${getServerBase()}${path}`, {
    method: (init && init.method) || 'GET',
    headers: { 'Content-Type': 'application/json', ...((init && init.headers) || {}) },
    ...(init && init.body ? { body: JSON.stringify(init.body) } : {}),
  });

  const text = await response.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch (error) {
    throw new Error(`服务端返回了无法解析的内容（HTTP ${response.status}）`);
  }
  if (!parsed) throw new Error(`服务端返回了空内容（HTTP ${response.status}）`);

  /*
   * ⚠️ **非 2xx 必须抛错。**
   *
   * 原来这里是直接 `return parsed`——把错误体当成正常响应交给调用方。
   * 后果：401 时 `fetchPhigrosBests` 返回 null，调用方的 `.catch` 根本不触发，
   * 接着 `apply(null)` 里读 `null.stats` 直接抛 TypeError。
   *
   * 而 `jsonRequest` 的所有调用方都是「拿 payload.data + 兜底」的写法，
   * 所以改成抛错之后它们的 `.catch` 会正常接管——**严格更正确**。
   *
   * 错误对象上带 `status`，调用方据此区分「登录过期」和「网络故障」。
   */
  if (!response.ok) {
    const message =
      parsed && typeof parsed === 'object' && typeof parsed.message === 'string' && parsed.message
        ? parsed.message
        : `服务端返回 HTTP ${response.status}`;
    const error = new Error(message);
    // 用自定义属性而不是子类：Vela 的 Error 子类行为不一定可靠
    error.status = response.status;
    error.serverCode = parsed && typeof parsed === 'object' ? parsed.code : undefined;
    throw error;
  }

  return parsed;
}

/**
 * 发起配对，拿一个 8 位配对码。
 * 只上送设备密钥的**哈希**——原文永远不出设备。
 */
export async function startPairing(deviceSecretHash) {
  const payload = await jsonRequest('/api/pair/start', {
    method: 'POST',
    body: { deviceSecretHash },
  });
  const data = payload && payload.data ? payload.data : {};
  if (!data.token) {
    throw new Error((payload && payload.message) || '服务端没有返回配对码');
  }
  return data;
}

/** 轮询有没有数据。**必须带设备密钥原文**，否则服务端不会给。 */
export async function pollPairing(token, deviceSecret) {
  const payload = await jsonRequest(`/api/pair/poll?token=${encodeURIComponent(token)}`, {
    headers: { 'X-Device-Secret': deviceSecret },
  });
  return (payload && payload.data) || { status: 'expired' };
}

/** 取走后要求服务端立刻删除暂存数据。 */
export async function consumePairing(token, deviceSecret) {
  const payload = await jsonRequest('/api/pair/consume', {
    method: 'POST',
    headers: { 'X-Device-Secret': deviceSecret },
    body: { token, deviceSecret },
  });
  return Boolean(payload && payload.data && payload.data.removed);
}


// ── Phigros ─────────────────────────────────────────────────────────────
//
// 和落雪的模型不同：玩家标识是一次 **TapTap 扫码**换来的 sessionToken，
// 没有「按好友码查任何人」的入口。所以扫码这一步只能在这里做，查分时带着凭证。

/**
 * 生成 TapTap 登录二维码。
 *
 * 服务端只回 `verificationUrl`（**不回 SVG 图片**，手表渲染不了 SVG），
 * 直接喂给 Vela 原生的 <qrcode value="..."> 即可。
 */
export async function createPhigrosQr(version = 'cn') {
  const payload = await jsonRequest(`/api/v1/phigros/qr?version=${version}`, { method: 'POST' });
  return (payload && payload.data) || {};
}

/** 轮询扫码状态。登录成功后返回的 sessionToken 就是要存下来的凭证。 */
export async function pollPhigrosQr(qrId) {
  const payload = await jsonRequest(`/api/v1/phigros/qr/${encodeURIComponent(qrId)}`);
  return (payload && payload.data) || { status: 'Unknown' };
}

/**
 * 查 Phigros 成绩。
 *
 * 凭证走请求头而不是 URL —— URL 会进访问日志，
 * 而平台的使用条款明确禁止把 token 写进日志。
 */
export async function fetchPhigrosBests(sessionToken) {
  const payload = await jsonRequest('/api/v1/phigros/bests', {
    headers: { 'X-Phigros-Session': sessionToken },
  });
  return (payload && payload.data) || null;
}

/**
 * 查 osu! 最好成绩。
 *
 * 用**用户名**，不是好友码。服务端需要配好 OSU_CLIENT_ID / SECRET；
 * 没配的时候 `/api/v1/osu/bests` 会返回 400 并说明原因。
 *
 * ⚠️ 上游限流很紧（全应用共享 60 次/分钟，我们一次查询花 2 次）。
 * 超了服务端返回 `rate-limited`，**不要自动重试**——重试只会让情况更糟。
 */
export async function fetchOsuBests(username, options) {
  const limit = options && options.limit ? options.limit : 50;
  const ruleset = options && options.ruleset ? options.ruleset : 'osu';
  const query = encodeURIComponent(username);
  const payload = await jsonRequest(
    `/api/v1/osu/bests?username=${query}&ruleset=${ruleset}&limit=${limit}`,
  );
  return (payload && payload.data) || null;
}

/**
 * Phigros 曲目搜索。平台唯一的曲库入口，没有全量列表。
 *
 * ⚠️ **在这里把形状统一成 `{ results }`**，和落雪那两个接口对齐。
 *
 * 起因是一个真 bug：平台返回 `{ items, total, ... }`，而落雪返回
 * `{ keyword, count, results }`。页面原来写死读 `payload.results`，
 * 于是 Phigros 搜索恒为空数组、且不报错。
 *
 * 当时的修法是在页面里加分支，但那只解决这一次——
 * **只要三个接口形状不同，任何新页面都会再踩一遍**。
 * 所以改成在源头归一：调用方只认一种形状。
 */
export async function searchPhigrosSongs(keyword, limit = 20) {
  const query = encodeURIComponent(keyword);
  const payload = await jsonRequest(`/api/v1/phigros/search?q=${query}&limit=${limit}`);
  const data = (payload && payload.data) || {};
  const items = data.items || [];
  return {
    // 统一成 results，和 searchSongs / searchChunithmSongs 一致
    results: items,
    total: typeof data.total === 'number' ? data.total : items.length,
    hasMore: Boolean(data.hasMore),
  };
}
