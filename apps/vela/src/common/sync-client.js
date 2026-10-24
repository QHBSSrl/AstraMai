/**
 * 同步服务的 HTTP 客户端（手表侧）。
 *
 * ── 为什么单独一个文件，不塞进 api.js ────────────────────────────────
 *
 * `api.js` 打的是**我们自己的主服务器**（B50 / 搜索 / 曲库）。
 * 同步打的是 **Cloudflare Workers**，地址、错误形状、超时都不一样。
 *
 * 混在一个文件里，以后改一边的超时很可能顺手改了另一边。
 *
 * ── 地址可以覆盖 ────────────────────────────────────────────────────
 *
 * Worker 还没部署（要用户自己的 Cloudflare 账号）。
 * 所以基址从 storage 读，设置页可以改 —— 比写死一个还没上线的域名好，
 * 那种情况的表现是"点了没反应"，比"没配置"更难查。
 */

import { createVelaFetch } from './vela-fetch.js';

/** 默认的 Worker 地址。部署后如果换了域名，在设置里改即可。 */
/**
 * 直连 Cloudflare（首选）。
 *
 * 大陆实测中位数 **272ms**，能通。不需要中转。
 */
export const DEFAULT_SYNC_BASE = 'https://worksync.astramai.astranexus.cn';



/** 本地 `wrangler dev` 的地址。 */
export const LOCAL_SYNC_BASE = 'http://127.0.0.1:8787';

const SYNC_BASE_KEY = 'syncBase';

/**
 * 同步请求的超时。
 *
 * 比普通查询短：同步是"人站在那儿等"的操作，等 25 秒不如早点告诉他失败。
 */
const TIMEOUT_MS = 12000;

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

/** 读同步服务的首选基址。设置页可以覆盖。 */
export function getSyncBase(readSetting) {
  const saved = readSetting ? String(readSetting(SYNC_BASE_KEY, '') || '').trim() : '';
  return saved || DEFAULT_SYNC_BASE;
}

/**
 * 这次请求要试哪些地址，按顺序。
 *
 * ── 为什么要试多个 ──────────────────────────────────────────────
 *
 * 手表走的是它自己的 WiFi / 蓝牙链路，和电脑用的不是一条路，
 * TLS 栈也不一样。**我没法在这里验证它到 Cloudflare 通不通。**
 *
 * 所以：先试直连（快，272ms），不通就换大陆反代（慢些但确定能到）。
 * 多花一次失败的 12 秒，换"总有一条路能用"。
 *
 * 用户在设置里指定了地址时**只试那个** —— 他既然手动填了，
 * 就说明他知道自己在干什么，别自作主张换路。
 */
export function candidateBases(readSetting) {
  const saved = readSetting ? String(readSetting(SYNC_BASE_KEY, '') || '').trim() : '';
  if (saved) return [saved];

  return [DEFAULT_SYNC_BASE];
}

/** 保存同步服务的基址（去掉末尾斜杠，否则拼出来是 `//sync/create`）。 */
export function setSyncBase(writeSetting, url) {
  const trimmed = String(url || '').trim().replace(/\/+$/, '');
  writeSetting(SYNC_BASE_KEY, trimmed);
}

export { SYNC_BASE_KEY };

/**
 * 把 Worker 的 error 码翻成人话。
 *
 * 手表屏幕小，`pin_mismatch` 直接显示出来没人看得懂。
 */
export function syncErrorMessage(code, status) {
  switch (code) {
    case 'pin_mismatch':
      return '密码不对';
    case 'not_found':
      return '配对码不存在或已过期';
    case 'not_uploaded':
      return '对方还没上传数据';
    case 'expired':
      return '已过期，重新生成配对码';
    case 'too_large':
      return '数据太大，超过 256 KB';
    case 'rate_limited':
      return '请求太频繁，等一分钟再试';
    case 'invalid_pin':
      return '密码格式不对（要 4 位数字）';
    case 'network':
      return '连不上同步服务，检查网络';
    default:
      return '同步服务出错（' + (code || status) + '）';
  }
}

/**
 * 统一的请求封装：解析 JSON、把 `{ok:false,error}` 变成异常。
 *
 * ⚠️ `createVelaFetch` 返回的是 `{ ok, status, text() }` ——
 * 正文要**再 await 一次** `text()` 才拿得到。这里一次性处理掉，
 * 上层只需要拿对象。
 */
function request(base, path, init) {
  const systemFetch = getFetchModule();
  if (!systemFetch) {
    return Promise.reject(new Error('当前设备不提供 @system.fetch'));
  }

  const doFetch = createVelaFetch(systemFetch, { timeoutMs: TIMEOUT_MS });

  return doFetch(base + path, init)
    .then((response) =>
      response.text().then((text) => {
        let body = null;
        try {
          body = text ? JSON.parse(text) : null;
        } catch (error) {
          throw new Error(syncErrorMessage('bad_response', response.status));
        }

        if (!response.ok || !body || body.ok !== true) {
          const code = body && body.error ? body.error : 'unknown';
          throw new Error(syncErrorMessage(code, response.status));
        }

        return body;
      }),
    );
}

/**
 * 创建配对码。
 *
 * @param {string} base 同步服务基址
 * @param {string} pin 4 位传输密码
 */
export function createSyncCode(base, pin) {
  return request(base, '/sync/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin }),
  });
}

/** 上传加密后的载荷。 */
export function putSyncPayload(base, code, pin, payload) {
  return request(base, '/sync/' + code, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin, payload }),
  });
}

/** 拉取加密后的载荷。 */
export function getSyncPayload(base, code, pin) {
  return request(base, '/sync/' + code + '?pin=' + encodeURIComponent(pin), {
    method: 'GET',
  });
}

/** 健康检查 —— 设置页用来测"填的地址对不对"。 */
export function checkSyncHealth(base) {
  return request(base, '/health', { method: 'GET' });
}

export default {
  DEFAULT_SYNC_BASE,
  LOCAL_SYNC_BASE,
  SYNC_BASE_KEY,
  getSyncBase,
  candidateBases,
  setSyncBase,
  syncErrorMessage,
  createSyncCode,
  putSyncPayload,
  getSyncPayload,
  checkSyncHealth,
};
