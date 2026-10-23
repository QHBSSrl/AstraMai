/**
 * AstroBox 网桥 —— 手表这一侧。
 *
 * ── 它解决什么问题 ──────────────────────────────────────────────────
 *
 * 手环（小米手环 10 Pro 之类）**没有网络**，只能靠蓝牙。
 * 手表（REDMI Watch 5 eSIM）自己能上网，用不上这个。
 *
 * 链路：
 *
 *     Vela App（本文件，@system.interconnect）
 *          ↕  蓝牙
 *     AstroBox 插件（跑在电脑上，能上网）
 *          ↕  HTTP
 *     我们的服务器
 *
 * ── 协议 ────────────────────────────────────────────────────────────
 *
 * 发：`{ id, action, game, code }`
 * 收：**分片**，每片 `{ id, seq, total, chunk }`，按 id 收齐后拼成
 *     `{ id, ok, data }`。
 *
 * 为什么必须分片：一份 B50 的 JSON 有十几 KB，而蓝牙单条消息有长度限制，
 * 具体上限我们不知道（宿主不告诉我们）。插件那边按 1800 字符切片，
 * 这里按同样的方式拼回来。
 *
 * ── 官方文档里的两个坑 ──────────────────────────────────────────────
 *
 * ① `manifest.json` 的 `features` 里必须有 `{ "name": "system.interconnect" }`，
 *    否则 `require('@system.interconnect')` 直接失败。
 *
 * ② `onmessage` 回调的参数是**包装过的**：真正的字符串在 `data.data`，
 *    不是 `data` 本身。文档示例里也是 `data.data`。
 */

const interconnect = require('@system.interconnect');

/**
 * 单条消息的字符上限，**必须和插件里的 CHUNK_SIZE 一致**。
 * 改一边不改另一边，拼包必然错位。
 */
const CHUNK_SIZE = 1800;

/** 一次请求最多等多久（毫秒）。超时就 reject，不然页面会一直转圈。 */
const REQUEST_TIMEOUT = 25000;

/** 连接对象。`interconnect.instance()` 是单例，只取一次。 */
let connect = null;

/** 自增请求 id。 */
let nextId = 0;

/**
 * 在途的请求：`{ [id]: { total, parts, resolve, reject, timer } }`。
 *
 * 用普通对象而不是 Map —— 手表运行时对 ES6 的支持不一定齐，
 * 而这种键值表用对象完全够。
 */
const pending = {};

/** 最近一次连接状态。1 = 已连接，2 = 断开，0 = 不知道。 */
let readyState = 0;

/** 有没有可用的连接对象。 */
export function isAvailable() {
  try {
    return Boolean(ensureConnect());
  } catch (error) {
    console.warn('[AstraMai] interconnect 不可用：', error);
    return false;
  }
}

/** 连接状态（1 连接成功 / 2 断开 / 0 未知）。 */
export function connectionState() {
  return readyState;
}

function ensureConnect() {
  if (connect) return connect;
  connect = interconnect.instance();

  // 收包 —— 注意是 data.data
  connect.onmessage = (data) => {
    handleIncoming(data && data.data);
  };

  connect.onopen = (data) => {
    readyState = 1;
    console.debug('[AstraMai] 网桥已连接，重连 =', data && data.isReconnected);
  };

  connect.onclose = (data) => {
    readyState = 2;
    console.warn('[AstraMai] 网桥断开：', data && data.code, data && data.data);
    // 断开时把所有在途请求都失败掉，否则它们会一直等到超时
    failAll('网桥已断开');
  };

  connect.onerror = (data) => {
    readyState = 2;
    console.warn('[AstraMai] 网桥出错：', data && data.code, data && data.data);
  };

  // 主动查一次状态（不依赖 onopen 是否已经触发过）
  try {
    connect.getReadyState({
      success: (data) => {
        readyState = data && data.status === 1 ? 1 : 2;
      },
      fail: () => {
        readyState = 2;
      },
    });
  } catch (error) {
    console.warn('[AstraMai] getReadyState 失败：', error);
  }

  return connect;
}

function failAll(reason) {
  Object.keys(pending).forEach((id) => {
    const entry = pending[id];
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    delete pending[id];
    entry.reject(new Error(reason));
  });
}

/**
 * 处理收到的分片。
 *
 * 单片就完整的响应（`total === 1`）也走同一条路 —— 不搞两套逻辑，
 * 少一条分支就少一类只在某种包长下才出现的 bug。
 */
function handleIncoming(raw) {
  if (typeof raw !== 'string' || !raw) return;

  let frame;
  try {
    frame = JSON.parse(raw);
  } catch (error) {
    console.warn('[AstraMai] 收到非 JSON 的网桥消息：', String(raw).slice(0, 120));
    return;
  }

  const id = frame.id;
  if (!id) return;

  const entry = pending[id];
  if (!entry) {
    // 超时之后才到的残片，正常现象，忽略
    return;
  }

  entry.parts[frame.seq] = frame.chunk || '';
  entry.received += 1;
  if (entry.received < entry.total) return;

  // 收齐了
  delete pending[id];
  if (entry.timer) clearTimeout(entry.timer);

  const joined = entry.parts.join('');
  try {
    entry.resolve(JSON.parse(joined));
  } catch (error) {
    entry.reject(new Error(`网桥响应不是合法 JSON（${joined.length} 字符）`));
  }
}

/**
 * 发一个请求，等完整响应。
 *
 * @param {string} action `ping` / `b50`
 * @param {object} [options] 额外参数（`game`、`code` 等）
 * @returns {Promise<object>} 完整的响应体
 */
export function request(action, options = {}) {
  return new Promise((resolve, reject) => {
    let conn;
    try {
      conn = ensureConnect();
    } catch (error) {
      reject(new Error('网桥不可用，请先装 AstroBox 插件'));
      return;
    }

    nextId += 1;
    const id = `req-${nextId}`;

    const timer = setTimeout(() => {
      if (!pending[id]) return;
      delete pending[id];
      reject(new Error('网桥超时（25 秒没回）'));
    }, REQUEST_TIMEOUT);

    pending[id] = {
      total: 0,
      parts: [],
      received: 0,
      resolve,
      reject,
      timer,
    };

    const payload = { id, action };
    Object.keys(options).forEach((key) => {
      payload[key] = options[key];
    });

    // ⚠️ 这里传的是**对象**（官方文档的示例也是这样）。
    // 宿主会把它序列化成字符串传给插件。如果哪天改成传字符串，
    // 插件那边的 json.loads 会解出字符串，得再解一层。
    try {
      conn.send({
        data: payload,
        fail: (data, code) => {
          if (!pending[id]) return;
          delete pending[id];
          clearTimeout(timer);
          const message = (data && data.data) || `错误码 ${code}`;
          reject(new Error(`发送失败：${message}`));
        },
      });
    } catch (error) {
      delete pending[id];
      clearTimeout(timer);
      reject(new Error(`发送异常：${error}`));
    }
  });
}

/** 探活 —— 插件不碰网络，只回一个 pong。用来判断链路是否通。 */
export function ping() {
  return request('ping');
}

/** 查 B50。`game` 目前支持 `maimai` / `chunithm`。 */
export function fetchB50(game, code) {
  return request('b50', { game, code });
}
