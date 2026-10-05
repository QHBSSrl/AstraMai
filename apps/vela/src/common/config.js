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
 * 这是**你自己的服务器**，服务端代码在 `apps/server`，部署方式见 `docs/deploy-baota.md`。
 * 注意是 `http://` + 端口：域名没备案，暂时绑不了域名，也就没有 TLS。
 *
 * 另外两个地址在不同环境下才是对的，别混用：
 *   - `http://10.0.2.2:8787` —— **模拟器**里宿主机的地址
 *     （模拟器 wlan0 是 10.0.2.15、网关 10.0.2.2，实测确认）。
 *     模拟器填局域网 IP 或 localhost 都连不上。
 *   - `http://192.168.x.x:8787` —— 电脑上直连同一局域网的服务端
 */
export const DEFAULT_SERVER_BASE = 'http://101.132.148.117:8787';

/** 模拟器专用的服务端地址，便于本地联调时切回来。 */
export const EMULATOR_SERVER_BASE = 'http://10.0.2.2:8787';

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
