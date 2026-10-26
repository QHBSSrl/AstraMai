/**
 * FetchBridge 客户端（手表侧）。
 *
 * 对接官方的「网桥 FetchBridge」插件：
 *   https://github.com/AstralSightStudios/AstroBox-NG-Plugin-MiWear-InterconnectFetch
 *
 * ── 为什么用它，不用我们自己写的那个 ────────────────────────────────
 *
 * 我们自己写过一个 Python 插件，用 `browser.open` + `eval` 发 XHR —— 能跑，
 * 但**每次都会弹一个窗口**，还要用户点授权。用户的原话是
 * 「你为啥非要死磕这个网页，我们只是要他能与手机通信」。
 *
 * 而官方插件直接用 `wasi:http`（Rust 的 `waki` crate）发请求，
 * 没有浏览器、没有弹窗、没有授权。而且它已经解决了分片死锁
 * （v3 的累计 ACK + 滑动窗口），那是我们自己写一定会踩的坑。
 *
 * ── 两种传输方式，用户自己选 ────────────────────────────────────────
 *
 *   'single'  走 v1 单消息。一次一帧，快、简单，但**上限 16 KB**
 *             （`MAX_UNCHUNKED_WIRE_LEN`），超了插件直接报错。
 *   'stream'  走 v4 开放长度流。分片 + 逐帧 CRC32 + 累计 ACK 流控，
 *             没有长度限制，但要处理重传和乱序。
 *
 * 所以「完整/分片」不是技术细节，是**用户可感知的取舍**：
 *   · 只想看 B50 → single 更快，而且服务端有 compact 端点把它压到 5 KB
 *   · 想看完整数据（含封面、别名、物量）→ stream
 *
 * ── 协议要点（摘自官方的 PROTOCOL.md）──────────────────────────────
 *
 * 握手：`{tag:'__hs__', count:N, caps}` 来回三次，`count>=2` 结束。
 *
 * 请求：`{tag:'fetch', id, url, options:{method, headers, body, stream?}}`
 *
 * 响应头：`{tag:'fetch', id, resp:{ok, status, statusText, headers, body, raw,
 *          stream?, chunkSize?, bodyEncoding?, ack?, checksum?, contentLength?}}`
 *
 * 数据帧：`{tag:'fetch-stream', id, seq, offset, data, crc32, final?, totalBytes?}`
 *
 * ACK：  `{tag:'fetch-stream-ack', id, ack}` —— `ack` 是「下一个还缺的序号」
 */

// ── 常量 ──────────────────────────────────────────────────────────────

/** 握手要来回几次。协议规定 `count >= 2` 就停。 */
const HANDSHAKE_ROUNDS = 2;

/** 握手超时。超过就当插件没响应。 */
const HANDSHAKE_TIMEOUT = 6000;

/** 单个请求的总超时。 */
const REQUEST_TIMEOUT = 30000;

/** 我们声明的单分片上限（编码前字节数）。协议允许 256~65536。 */
const MAX_CHUNK_SIZE = 4096;

/** 希望的在途分片窗口。协议会夹到 [1, 64]。 */
const ACK_WINDOW = 4;

/** 传输模式。 */
export const MODE = {
  /** v1 单消息。快，但 16 KB 以上会失败。 */
  SINGLE: 'single',
  /** v4 开放长度流。分片 + CRC32 + ACK 流控。 */
  STREAM: 'stream',
};

// ── 能力声明 ──────────────────────────────────────────────────────────

/**
 * 按模式生成 `caps`。
 *
 * ⚠️ `stream: true` 必须**同时**声明 `chunk: true` 和 `ack: true` ——
 * 协议写死了这个前提，否则插件会降级到旧路径。
 *
 * `encodings` 只声明 `base64`：手表侧解码 base64 很简单（一次查表循环），
 * 而 `hex` 会膨胀 2 倍，`text` 又不能承载二进制。base64 是最稳的。
 */
function capsFor(mode) {
  if (mode === MODE.STREAM) {
    return {
      version: 4,
      chunk: true,
      ack: true,
      stream: true,
      maxChunkSize: MAX_CHUNK_SIZE,
      ackWindow: ACK_WINDOW,
      encodings: ['base64'],
      compressions: ['none'],
    };
  }

  // 单消息模式：明确声明「不分片」，插件就永远走 v1 路径
  return { version: 1, chunk: false };
}

// ── base64 解码 ───────────────────────────────────────────────────────

const B64_TABLE = (() => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const table = new Int16Array(128).fill(-1);
  for (let i = 0; i < alphabet.length; i += 1) table[alphabet.charCodeAt(i)] = i;
  return table;
})();

/**
 * base64 → 字节数组。
 *
 * 不用 `@system.crypto.atob`：那个的返回值形态在各设备上不一致
 * （有的给字符串有的给 Uint8Array），而且我们后面要按字节算 CRC32，
 * 自己解反而更直接。
 */
export function base64ToBytes(text) {
  const clean = String(text || '').replace(/[^A-Za-z0-9+/]/g, '');
  const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4));

  let out = 0;
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < clean.length; i += 1) {
    const value = B64_TABLE[clean.charCodeAt(i)];
    if (value < 0) continue;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[out] = (buffer >> bits) & 0xff;
      out += 1;
    }
  }

  return bytes.subarray(0, out);
}

// ── CRC32 ─────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

/** 算一段字节的 IEEE CRC-32，返回小写 8 位十六进制。 */
export function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  crc = (crc ^ 0xffffffff) >>> 0;
  return crc.toString(16).padStart(8, '0');
}

// ── UTF-8 解码 ────────────────────────────────────────────────────────

/**
 * 字节 → 字符串。
 *
 * ⚠️ 不能用 `String.fromCharCode.apply(null, bytes)` —— 长数组会爆栈
 * （一次 4096 字节就接近上限了）。分块处理。
 */
function bytesToText(bytes) {
  const CHUNK = 512;
  let out = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  try {
    return decodeURIComponent(escape(out));
  } catch (error) {
    // 不是合法 UTF-8（比如二进制），原样返回
    return out;
  }
}

// ── 客户端 ────────────────────────────────────────────────────────────

/**
 * 造一个客户端。
 *
 * @param {object} options
 * @param {'single'|'stream'} [options.mode] 传输方式，默认 single
 * @param {function} [options.interconnect] 拿 `@system.interconnect` 实例的函数
 */
export function createFetchBridge(options = {}) {
  const mode = options.mode === MODE.STREAM ? MODE.STREAM : MODE.SINGLE;
  const getInterconnect = options.interconnect;

  let connect = null;
  let handshook = false;
  let handshaking = null;
  let nextId = 0;

  /** 按 id 挂起的请求。 */
  const pending = Object.create(null);

  function ensureConnect() {
    if (connect) return connect;
    if (typeof getInterconnect !== 'function') {
      throw new Error('没提供 interconnect，无法连网桥');
    }
    connect = getInterconnect();
    connect.onmessage = (frame) => {
      handleIncoming(frame && frame.data !== undefined ? frame.data : frame);
    };
    return connect;
  }

  /** 发一帧 JSON。 */
  function send(payload) {
    const link = ensureConnect();
    // 宿主会序列化对象，和我们的 Python 插件那边一样
    link.send({ data: payload });
  }

  /** 收一帧。 */
  function handleIncoming(raw) {
    if (typeof raw !== 'string' || !raw) return;

    let frame;
    try {
      frame = JSON.parse(raw);
    } catch (error) {
      console.warn('[AstraMai] 网桥发来非 JSON：', String(raw).slice(0, 120));
      return;
    }

    if (!frame || typeof frame !== 'object') return;

    const tag = frame.tag;

    // 握手回包
    if (tag === '__hs__') {
      handleHandshake(frame);
      return;
    }

    // 响应头 / 单消息响应
    if (tag === 'fetch') {
      onFetchHeader(frame);
      return;
    }

    // v4 数据帧
    if (tag === 'fetch-stream') {
      onStreamFrame(frame);
      return;
    }
  }

  // ── 握手 ────────────────────────────────────────────────────────────

  let handshakeResolve = null;

  function handleHandshake(frame) {
    const count = Number(frame.count);

    // 对方也在探活：只要它 count < 2 就回一帧
    if (count < HANDSHAKE_ROUNDS && handshook === false) {
      send({ tag: '__hs__', count: count + 1, caps: capsFor(mode) });
    }

    if (count >= HANDSHAKE_ROUNDS && handshakeResolve) {
      handshook = true;
      const done = handshakeResolve;
      handshakeResolve = null;
      done();
    }
  }

  /**
   * 握手。
   *
   * 协议只要求来回三次；我们额外做的是：**超时也放行**。
   * 因为插件可能在收到的第一帧里就直接回 `count:2` 跳过中间步骤，
   * 死等第三帧会让第一次请求白等 6 秒。
   */
  function handshake() {
    if (handshook) return Promise.resolve();
    if (handshaking) return handshaking;

    handshaking = new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        handshook = true;
        handshaking = null;
        resolve();
      };

      handshakeResolve = done;

      try {
        send({ tag: '__hs__', count: 0, caps: capsFor(mode) });
      } catch (error) {
        settled = true;
        handshaking = null;
        handshakeResolve = null;
        resolve();
        return;
      }

      setTimeout(done, HANDSHAKE_TIMEOUT);
    });

    return handshaking;
  }

  // ── 请求 ────────────────────────────────────────────────────────────

  /**
   * 发一个请求。
   *
   * @param {string} url 完整 URL
   * @param {object} [init] `{ method, headers, body }`，形态和 fetch 的 init 一致
   * @returns {Promise<{status:number, ok:boolean, text:string}>}
   */
  function request(url, init = {}) {
    return handshake().then(
      () =>
        new Promise((resolve, reject) => {
          nextId += 1;
          const id = `fb-${nextId}`;

          const timer = setTimeout(() => {
            if (!pending[id]) return;
            delete pending[id];
            reject(new Error('网桥超时（30 秒没回）'));
          }, REQUEST_TIMEOUT);

          pending[id] = {
            id,
            resolve,
            reject,
            timer,
            header: null,
            chunks: [],
            received: 0,
            nextAck: 0,
            expectFinal: false,
            totalBytes: 0,
          };

          const payload = {
            tag: 'fetch',
            id,
            url,
            options: {
              method: String(init.method || 'GET').toUpperCase(),
              ...(init.headers ? { headers: init.headers } : {}),
              ...(init.body !== undefined && init.body !== null ? { body: String(init.body) } : {}),
              ...(mode === MODE.STREAM ? { stream: true } : {}),
            },
          };

          try {
            send(payload);
          } catch (error) {
            delete pending[id];
            clearTimeout(timer);
            reject(error);
          }
        }),
    );
  }

  /** 收到 `tag:'fetch'` 帧。 */
  function onFetchHeader(frame) {
    const id = frame.id;
    const entry = pending[id];
    if (!entry) return;

    const resp = frame.resp || {};

    // 流式响应：这里只是头，数据在后面
    if (resp.stream === true) {
      entry.header = resp;
      entry.expectFinal = true;
      return;
    }

    // 单消息响应：body 已经在里面了
    delete pending[id];
    clearTimeout(entry.timer);

    if (resp.ok === false) {
      entry.reject(
        new Error(`网桥请求失败：HTTP ${resp.status || 0} ${resp.statusText || ''}`.trim()),
      );
      return;
    }

    entry.resolve({
      status: Number(resp.status) || 0,
      ok: Number(resp.status) >= 200 && Number(resp.status) < 300,
      text: decodeBody(resp, String(resp.body || '')),
      headers: resp.headers || {},
    });
  }

  /** 按 `bodyEncoding` / `raw` 还原响应体。 */
  function decodeBody(resp, body) {
    const encoding = String(resp.bodyEncoding || (resp.raw ? 'base64' : 'text'));
    if (encoding === 'base64') {
      const bytes = base64ToBytes(body);
      return resp.raw ? bytes : bytesToText(bytes);
    }
    if (encoding === 'hex') {
      const bytes = new Uint8Array(Math.floor(body.length / 2));
      for (let i = 0; i < bytes.length; i += 1) {
        bytes[i] = parseInt(body.substr(i * 2, 2), 16);
      }
      return resp.raw ? bytes : bytesToText(bytes);
    }
    return body;
  }

  // ── v4 流 ───────────────────────────────────────────────────────────

  /** 收到一帧数据。 */
  function onStreamFrame(frame) {
    const id = frame.id;
    const entry = pending[id];
    if (!entry) return;

    const seq = Number(frame.seq);
    const data = frame.data === undefined || frame.data === null ? '' : String(frame.data);

    const bytes = data ? base64ToBytes(data) : new Uint8Array(0);

    // 校验：协议要求 CRC 失败**不得推进 ACK**
    const expected = String(frame.crc32 || '').toLowerCase();
    if (!frame.final && expected && crc32(bytes) !== expected) {
      console.warn(`[AstraMai] 第 ${seq} 片 CRC 不对，等重传`);
      sendAck(id, entry.nextAck);
      return;
    }

    // 只按连续序号消费 —— 乱序的帧丢弃，让插件 go-back-N 重传
    if (seq !== entry.nextAck) {
      sendAck(id, entry.nextAck);
      return;
    }

    entry.chunks.push(bytes);
    entry.totalBytes += bytes.length;
    entry.received += 1;
    entry.nextAck = seq + 1;

    sendAck(id, entry.nextAck);

    if (frame.final === true) {
      delete pending[id];
      clearTimeout(entry.timer);

      const header = entry.header || {};
      const merged = concatBytes(entry.chunks, entry.totalBytes);
      const raw = header.raw === true;

      entry.resolve({
        status: Number(header.status) || 0,
        ok: Number(header.status) >= 200 && Number(header.status) < 300,
        text: raw ? merged : bytesToText(merged),
        headers: header.headers || {},
        totalBytes: entry.totalBytes,
      });
    }
  }

  function sendAck(id, ack) {
    try {
      send({ tag: 'fetch-stream-ack', id, ack });
    } catch (error) {
      console.warn('[AstraMai] 回 ACK 失败：', error);
    }
  }

  function concatBytes(list, total) {
    const out = new Uint8Array(total);
    let at = 0;
    for (const item of list) {
      out.set(item, at);
      at += item.length;
    }
    return out;
  }

  // ── 对外 ────────────────────────────────────────────────────────────

  return {
    mode,

    /** 探活：和插件握一次手。 */
    ping() {
      return handshake().then(() => true);
    },

    /** 发请求。返回 `{ status, ok, text }`。 */
    request,

    /**
     * 发请求并解析 JSON。
     *
     * 和 `fetch` + `response.json()` 的组合等价，
     * 方便直接替换掉 `bridge-fetch.js`。
     */
    requestJson(url, init) {
      return request(url, init).then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return typeof response.text === 'string' ? JSON.parse(response.text) : null;
      });
    },

    /** 换模式要重握手。 */
    reset() {
      handshook = false;
      handshaking = null;
      handshakeResolve = null;
    },
  };
}
