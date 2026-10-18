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
import { createVelaFetch } from './vela-fetch.js';

export { DEFAULT_SERVER_BASE, getApiToken, getServerBase } from './config.js';

let fetchModule;
function getFetchModule() {
  if (fetchModule !== undefined) return fetchModule;
  try {
    // eslint-disable-next-line global-require
    fetchModule = require('@system.fetch') || null;
  } catch (error) {
    console.warn('[AstraMai] @system.fetch 不可用：', error);
    fetchModule = null;
  }
  return fetchModule;
}

let cachedClient = null;
let cachedBase = null;
let cachedToken = null;

/** 取一个绑定到当前配置的客户端（地址或令牌变了会自动重建）。 */
export function getClient(base) {
  const target = base || getServerBase();
  const token = getApiToken();
  if (cachedClient && cachedBase === target && cachedToken === token) return cachedClient;

  const systemFetch = getFetchModule();
  if (!systemFetch) {
    throw new Error('当前设备不提供 @system.fetch，无法发起网络请求');
  }

  const velaFetch = createVelaFetch(systemFetch, { timeoutMs: 12000 });
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
export function fetchB50(friendCode) {
  return getClient().request(`/api/maimai/b50/${friendCode}`);
}

/** 按 QQ 号拉取 B50。 */
export function fetchB50ByQq(qq) {
  return getClient().request(`/api/maimai/b50/qq/${qq}`);
}

/**
 * 中二节奏成绩（B30 + Selection10 + Recent10）。
 *
 * ⚠️ 路径是 `bests` 而不是 `b50`：中二不是 B50 那个玩法，
 * 视图结构也不同（bests/selections/recents 三组并列，而不是 B35+B15）。
 * 复用舞萌的字段名会让调用方以为拿到的是同一种东西。
 */
export function fetchChunithmBests(friendCode) {
  return getClient().request(`/api/v1/chunithm/bests?code=${friendCode}`);
}

/** 中二节奏成绩，按 QQ 号。 */
export function fetchChunithmBestsByQq(qq) {
  return getClient().request(`/api/v1/chunithm/bests?qq=${qq}`);
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
  const systemFetch = getFetchModule();
  if (!systemFetch) {
    throw new Error('当前设备不提供 @system.fetch，无法发起网络请求');
  }
  rawFetch = createVelaFetch(systemFetch, { timeoutMs: 12000 });
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
