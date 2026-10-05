/**
 * 端上配置读取。
 *
 * 与 `api.js` 分开是有意的：本文件**只依赖 store**，不碰 `@system.fetch`。
 * 首页只需要显示「服务端地址」这种东西，没有理由把网络模块拖进它的模块图——
 * 那样一旦 fetch 不可用，首页会跟着一起白。
 */

import { readSetting } from './store.js';

/** 默认服务端地址。真机调试时改成可达的地址。 */
export const DEFAULT_SERVER_BASE = 'http://192.168.1.100:8787';

/**
 * 服务端地址。
 * 局域网调试填电脑 IP；经 frp 暴露后填公网地址。
 */
export function getServerBase() {
  return readSetting('serverBase', DEFAULT_SERVER_BASE);
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
