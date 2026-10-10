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

async function pairJson(path, init) {
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
  return parsed;
}

/**
 * 发起配对，拿一个 8 位配对码。
 * 只上送设备密钥的**哈希**——原文永远不出设备。
 */
export async function startPairing(deviceSecretHash) {
  const payload = await pairJson('/api/pair/start', {
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
  const payload = await pairJson(`/api/pair/poll?token=${encodeURIComponent(token)}`, {
    headers: { 'X-Device-Secret': deviceSecret },
  });
  return (payload && payload.data) || { status: 'expired' };
}

/** 取走后要求服务端立刻删除暂存数据。 */
export async function consumePairing(token, deviceSecret) {
  const payload = await pairJson('/api/pair/consume', {
    method: 'POST',
    headers: { 'X-Device-Secret': deviceSecret },
    body: { token, deviceSecret },
  });
  return Boolean(payload && payload.data && payload.data.removed);
}
