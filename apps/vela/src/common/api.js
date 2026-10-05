/**
 * 应用级数据访问。
 *
 * 这里做两件事：
 *   1. 把 Vela 的 `@system.fetch` 接到 `@astramai/core` 的 `LxnsClient` 上；
 *   2. 把「服务端地址」做成可配置项——手表访问的不是用户电脑上的 dev server，
 *      而是需要单独部署的一个实例。
 *
 * 注意：**开发者密钥不放这里**。手表是端侧设备，密钥应该由服务端持有；
 * 端上只请求我们自己服务端的聚合接口。
 */

import systemFetch from '@system.fetch'

import { LxnsClient } from './astramai-core.js'
import { readSetting } from './store.js'
import { createVelaFetch } from './vela-fetch.js'

/** 默认服务端地址。真机调试时改成电脑在局域网里的地址。 */
export const DEFAULT_SERVER_BASE = 'http://192.168.1.100:8787'

/** 读当前配置的服务端地址。 */
export function getServerBase() {
  return readSetting('serverBase', DEFAULT_SERVER_BASE)
}

let cachedClient = null
let cachedBase = null

/** 取一个绑定到 `base` 的落雪客户端（服务端地址变了会自动重建）。 */
export function getClient(base) {
  const target = base || getServerBase()
  if (cachedClient && cachedBase === target) return cachedClient

  const velaFetch = createVelaFetch(systemFetch, { timeoutMs: 12000 })
  cachedClient = new LxnsClient({ baseUrl: target, fetchImpl: velaFetch })
  cachedBase = target
  return cachedClient
}

/**
 * 拉取 B50 聚合结果。
 *
 * 服务端已经把玩家信息、曲库、Rating 对拍全部组装好了，端上拿到的就是
 * 可以直接渲染的视图模型——手表算力和流量都紧张，不适合端上拼装。
 */
export function fetchB50(friendCode) {
  return getClient().request(`/api/maimai/b50/${friendCode}`)
}

/** 服务端健康检查，用来判断地址填对没有。 */
export function fetchHealth() {
  return getClient().request('/api/health')
}

/** 换服务端地址后调用，清掉缓存。 */
export function resetClient() {
  cachedClient = null
  cachedBase = null
}
