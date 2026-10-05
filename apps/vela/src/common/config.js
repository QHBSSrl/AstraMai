/**
 * 端上配置读取。
 *
 * 与 `api.js` 分开是有意的：本文件**只依赖 store**，不碰 `@system.fetch`。
 * 首页只需要显示「服务端地址」这种东西，没有理由把网络模块拖进它的模块图——
 * 那样一旦 fetch 不可用，首页会跟着一起白。
 */

import { readSetting } from './store.js';

/**
 * 默认服务端地址。
 *
 * ⚠️ `10.0.2.2` 是 **QEMU 用户态网络里宿主机的地址**。
 * Vela 模拟器的 `wlan0` 是 `10.0.2.15`、网关是 `10.0.2.2`（实测确认），
 * 所以模拟器要访问跑在电脑上的服务端，必须用 `10.0.2.2` ——
 * 填局域网 IP（192.168.x.x）或 `localhost` 都连不上。
 *
 * 真机上这个值不对，需要通过设置页填 frp 暴露出来的地址。
 */
export const DEFAULT_SERVER_BASE = 'http://10.0.2.2:8787';

/**
 * 服务端地址。
 * 模拟器用默认值；真机经 frp 暴露后填公网地址；局域网调试填电脑 IP。
 */
export function getServerBase() {
  return readSetting('serverBase', DEFAULT_SERVER_BASE);
}

/** 规范化用户填的地址：补协议、去掉结尾斜杠。 */
export function normalizeServerBase(input) {
  let value = String(input ?? '').trim();
  if (!value) return '';
  if (!/^https?:\/\//i.test(value)) value = `http://${value}`;
  return value.replace(/\/+$/, '');
}

/**
 * 访问令牌。
 *
 * 服务端一旦设了 `API_TOKEN`（暴露到公网时必须设），
 * 除健康检查外的接口都要求带上它。
 */
export function getApiToken() {
  return readSetting('apiToken', '');
}

/** 需要让用户配置的项，设置页可以按这个列表渲染。 */
export const SETTING_KEYS = ['serverBase', 'apiToken', 'friendCode', 'qrInput'];
