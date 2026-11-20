/**
 * 端上报诊断 —— 环形缓冲 + 报错时上传上下文。
 *
 * ── 为什么要改成这样 ────────────────────────────────────────────────
 *
 * 以前的实现是「每条 mark 都单独发一次 POST」。问题很多：
 *   · 一次页面跳转能发十几条请求，浪费流量和电
 *   · 每条之间没有关联，看不出一件事的前因后果
 *   · 正常路径刷了一堆，出事时反而看不出什么
 *
 * 现在：
 *   · 所有日志先进**内存环形缓冲**（不联网）
 *   · 只有**报错**才上传，而且带上**前 3 分钟**的日志
 *   · 3 分钟后如果 App 还活着，再补一个**后 3 分钟**的包
 *
 * ── 三条硬约束（沿用原来的）────────────────────────────────────────
 *
 *   1. **绝不抛异常**。诊断模块自己崩了就成了新的故障源。
 *   2. **绝不用静态 import 平台模块**。`@system.fetch` 取不到时，
 *      页面初始化会整体失败。
 *   3. **不阻塞**。上传全部 fire-and-forget。
 */

import { getServerBase } from './config.js';

/** 缓冲多少条。3 分钟大约几十条，给到 240 足够。 */
const BUFFER_MAX = 240;

/** 单条内容最大字符数。 */
const LINE_MAX = 600;

/** 报错前后各取多久（毫秒）。 */
const WINDOW_MS = 3 * 60 * 1000;

/** 事件之间至少间隔多久才记录（毫秒）—— 防刷屏。 */
const MIN_GAP_MS = 60;

/** 环形缓冲。`{ t: 时间戳, lv: 级别, m: 内容 }`。 */
const buffer = [];

/** 上次记录时刻，用来做 MIN_GAP 去抖。 */
let lastAt = 0;

/** 匿名设备标识：首次生成后存 storage，不涉及硬件信息。 */
let deviceId = '';

let fetchModule;

function getFetch() {
  if (fetchModule !== undefined) return fetchModule;
  try {
    // eslint-disable-next-line global-require
    const mod = require('@system.fetch') || null;
    fetchModule = typeof mod === 'function' ? mod : mod && mod.default;
  } catch (error) {
    fetchModule = null;
  }
  return fetchModule;
}

/**
 * 发一个请求。优先 `@system.fetch`，没有就走网桥。
 *
 * ⚠️ 手环没有 fetch，只能走手机中转。走不通就静默丢掉 ——
 * 诊断通道不值得为它引入失败分支。
 */
function upload(path, body) {
  const base = getServerBase();
  if (!base) return;

  const doFetch = getFetch();
  if (typeof doFetch === 'function') {
    try {
      doFetch({
        url: `${base}${path}`,
        method: 'POST',
        header: { 'Content-Type': 'application/json' },
        data: body,
        success: () => {},
        fail: () => {},
      });
      return;
    } catch (error) {
      // 掉到下面试网桥
    }
  }

  // 没有 fetch —— 试网桥
  try {
    // eslint-disable-next-line global-require
    const bridge = require('./bridge-fetch.js');
    if (bridge && typeof bridge.isBridgeFetchAvailable === 'function' && bridge.isBridgeFetchAvailable()) {
      const impl = bridge.createBridgeFetch();
      impl(`${base}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      }).catch(() => {});
    }
  } catch (error) {
    // 网桥也没有，放弃
  }
}

/** 把任意值压成短字符串。 */
function shorten(value, max) {
  try {
    if (value === null || value === undefined) return '';
    let text;
    if (typeof value === 'string') {
      text = value;
    } else if (value instanceof Error) {
      text = `${value.name || 'Error'}: ${value.message || ''}`;
    } else {
      text = JSON.stringify(value);
    }
    return String(text || '').slice(0, max);
  } catch (error) {
    return '(无法序列化)';
  }
}

/**
 * 记一条日志到缓冲。
 *
 * @param {string} level  log / warn / error / mark
 * @param {string} text   内容
 * @param {boolean} force 跳过去抖（错误必须记）
 */
export function log(level, text, force) {
  try {
    const now = Date.now();
    if (!force && now - lastAt < MIN_GAP_MS) return;
    lastAt = now;

    buffer.push({ t: now, lv: String(level || 'log').slice(0, 8), m: shorten(text, LINE_MAX) });
    if (buffer.length > BUFFER_MAX) buffer.splice(0, buffer.length - BUFFER_MAX);
  } catch (error) {
    // 记日志失败就失败
  }
}

/** 取一个时间窗口内的条目。 */
function windowOf(fromMs, toMs) {
  const out = [];
  for (let i = 0; i < buffer.length; i += 1) {
    const e = buffer[i];
    if (e.t >= fromMs && e.t <= toMs) out.push(e);
  }
  return out;
}

/** 拿（或生成）匿名设备标识。 */
function device() {
  if (deviceId) return deviceId;
  try {
    // eslint-disable-next-line global-require
    const store = require('./store.js');
    let id = store.readSetting('diagDevice', '');
    if (!id) {
      /*
       * 用「启动时刻 + 随机」拼一个，不碰任何硬件标识。
       * 目的只是把同一台设备的多次报错串起来，不是识别用户。
       */
      id = `d${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
      store.writeSetting('diagDevice', id);
    }
    deviceId = id;
  } catch (error) {
    deviceId = `x${Date.now().toString(36)}`;
  }
  return deviceId;
}

/** 发一个包。永不抛错。 */
function send(scope, message, stack, at, entries, phase) {
  if (entries.length === 0) return;
  try {
    const body = JSON.stringify({
      device: device(),
      scope: shorten(scope, 80),
      message: shorten(message, 1000),
      stack: shorten(stack, 8000),
      at,
      phase,
      entries,
    });
    upload('/api/logs', body);
  } catch (error) {
    // 序列化失败就算了
  }
}

/**
 * 上报一个异常。
 *
 * 会立刻发「前 3 分钟」，并安排 3 分钟后再发「后 3 分钟」。
 */
export function reportError(scope, error) {
  try {
    let message = '';
    let stack = '';
    try {
      message = error && error.message ? String(error.message) : String(error);
      stack = error && error.stack ? String(error.stack) : '';
    } catch (nested) {
      message = '(读取错误信息时又出错了)';
    }

    const at = Date.now();
    log('error', `${scope} ${message}`, true);

    // 前 3 分钟（含这一刻的错误本身）
    send(scope, message, stack, at, windowOf(at - WINDOW_MS, at), 'before');

    /*
     * 后 3 分钟。
     *
     * ⚠️ 如果 App 在这 3 分钟内被杀掉，这个包就发不出去 ——
     * 这是刻意的取舍：先保证「出事前」能到，再补充「出事后」。
     * 反过来（等 3 分钟再发）在闪退场景下会一条都收不到。
     */
    setTimeout(() => {
      try {
        send(scope, message, stack, at, windowOf(at, at + WINDOW_MS), 'after');
      } catch (nested) {
        // 定时器里更不能抛
      }
    }, WINDOW_MS + 1000);
  } catch (error) {
    // 上报自己出错就算了
  }
}

/** 打一个「走到这儿了」的点。只进缓冲，不联网。 */
export function mark(step) {
  log('mark', step, false);
}

/**
 * 挂上 console 的钩子，把 warn / error 也收进缓冲。
 *
 * ⚠️ 必须防递归：包装函数里如果自己打了 console，会无限循环。
 * 所以用 `inside` 标志位，并且包装体本身用 try 包住。
 */
let hooked = false;
export function hookConsole() {
  if (hooked) return;
  hooked = true;

  let inside = false;

  ['log', 'warn', 'error'].forEach((level) => {
    try {
      const original = console[level];
      if (typeof original !== 'function') return;

      console[level] = function patched(...args) {
        if (!inside) {
          inside = true;
          try {
            log(level, args.map((a) => shorten(a, 200)).join(' '), level === 'error');
          } catch (error) {
            // 吞掉
          } finally {
            inside = false;
          }
        }
        try {
          original.apply(console, args);
        } catch (error) {
          // 原函数也出错就不要了
        }
      };
    } catch (error) {
      // 某个 level 挂不上就跳过
    }
  });
}

/** 兼容旧接口 —— 以前 report(event, message, detail) 直接发网络。 */
export function report(event, message, detail) {
  log(event, `${message} ${shorten(detail && detail.extra, 300)}`, false);
}
