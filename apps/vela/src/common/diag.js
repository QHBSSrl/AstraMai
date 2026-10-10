/**
 * 端上报诊断。
 *
 * 存在的理由：**真机拿不到日志**。Vela 的官方「真机调试」只支持 Xiaomi Watch S4
 * 且仅对合作方开放，普通手表既没有调试小尾巴也连不上 AIoT-IDE。
 * 手表上闪退时开发者手上什么都没有，只能靠猜——我为此浪费了好几轮。
 *
 * 所以让 App 自己把「走到哪一步 / 报了什么错」打回服务端。
 * 这不依赖任何平台工具，代价是**原生崩溃（比如 OOM）可能来不及上报**，
 * 但那时至少能看到最后走到了哪一步。
 *
 * 三条硬约束：
 *   1. **绝不抛异常**。诊断模块自己崩了，就成了新的故障源。
 *   2. **绝不用静态 import 平台模块**。`@system.fetch` 取不到时页面初始化会整体失败。
 *   3. **不阻塞**。全部 fire-and-forget，失败就丢掉。
 */

import { getServerBase } from './config.js';

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

/** 把任意东西转成短字符串，避免上报体过大或抛错。 */
function short(value, max) {
  try {
    if (value === null || value === undefined) return '';
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    return (text || '').slice(0, max);
  } catch (error) {
    return '(无法序列化)';
  }
}

/**
 * 上报一条事件。
 * 永远不会抛错，也永远不会返回值——调用方不需要关心结果。
 */
export function report(event, message, detail) {
  try {
    const doFetch = getFetch();
    if (typeof doFetch !== 'function') return;

    const base = getServerBase();
    if (!base) return;

    const body = JSON.stringify({
      event: short(event, 80),
      message: short(message, 1000),
      stack: short(detail && detail.stack, 4000),
      extra: short(detail && detail.extra, 1000),
    });

    doFetch({
      url: `${base}/api/diag`,
      method: 'POST',
      header: { 'Content-Type': 'application/json' },
      data: body,
      // 成败都不关心：诊断通道不该影响主流程
      success: () => {},
      fail: () => {},
    });
  } catch (error) {
    // 这里刻意吞掉一切
  }
}

/** 打一个「走到这儿了」的点。用于判断崩溃发生在哪一步之前。 */
export function mark(step) {
  report('mark', step);
}

/** 上报一个异常。 */
export function reportError(scope, error) {
  let message = '';
  let stack = '';
  try {
    message = error && error.message ? String(error.message) : String(error);
    stack = error && error.stack ? String(error.stack) : '';
  } catch (nested) {
    message = '(读取错误信息时又出错了)';
  }
  report(`${scope}`, message, { stack });
}
