/**
 * 访问控制。
 *
 * 存在的理由很具体：**服务端持有落雪开发者密钥**，一旦通过 frp 之类的方式
 * 暴露到公网而没有任何门禁，任何知道地址的人都能拿你的密钥和配额随便查分。
 *
 * 两道闸：
 *   1. 共享令牌——`API_TOKEN` 配置后，除健康检查外的所有 /api/* 都要带令牌；
 *   2. 限流——按来源 IP 的固定窗口计数，防止被当成免费代理刷。
 *
 * 这两道都是「够用就好」的量级，不追求抗攻击。真正的防护应当由 frps 侧
 * 的 TLS + 域名 + 反向代理规则一起承担。
 */

import type { IncomingMessage } from 'node:http';

import type { ServerConfig } from './config.js';

export interface GuardResult {
  ok: boolean;
  status: number;
  message: string;
}

export interface Guard {
  /** 检查一个请求是否放行。 */
  check(req: IncomingMessage, pathname: string): GuardResult;
  /** 供健康检查展示当前限流状态。 */
  stats(): { trackedClients: number; limitPerMinute: number; tokenRequired: boolean };
}

/**
 * 健康检查永远放行。
 * 手表要用它判断「地址填对没有」，此时还没法保证令牌已经配好。
 */
const OPEN_PATHS = new Set(['/api/health']);

export function createGuard(config: ServerConfig): Guard {
  const windows = new Map<string, { count: number; resetAt: number }>();
  const limit = config.rateLimitPerMinute;

  /** 顺手清理过期窗口，避免 Map 无限增长。 */
  function sweep(now: number): void {
    if (windows.size < 512) return;
    for (const [key, entry] of windows) {
      if (entry.resetAt <= now) windows.delete(key);
    }
  }

  return {
    check(req, pathname) {
      if (OPEN_PATHS.has(pathname)) return { ok: true, status: 200, message: '' };

      // ── 令牌 ────────────────────────────────────────────────────────
      if (config.apiToken) {
        const provided = extractToken(req);
        if (provided !== config.apiToken) {
          return {
            ok: false,
            status: 401,
            message: '缺少或错误的访问令牌。请在客户端设置 API_TOKEN 对应的值。',
          };
        }
      }

      // ── 限流 ────────────────────────────────────────────────────────
      if (limit > 0) {
        const now = Date.now();
        sweep(now);
        const key = clientKeyOf(req);
        const entry = windows.get(key);
        if (!entry || entry.resetAt <= now) {
          windows.set(key, { count: 1, resetAt: now + 60_000 });
        } else {
          entry.count += 1;
          if (entry.count > limit) {
            return {
              ok: false,
              status: 429,
              message: `请求过于频繁（每分钟上限 ${limit} 次），请稍后再试。`,
            };
          }
        }
      }

      return { ok: true, status: 200, message: '' };
    },

    stats() {
      return {
        trackedClients: windows.size,
        limitPerMinute: limit,
        tokenRequired: config.apiToken !== undefined,
      };
    },
  };
}

/**
 * 从请求头取令牌。
 *
 * 同时接受三种写法，是为了让客户端不用为「访问自己的服务端」再写一套头：
 *   - `Authorization: Bearer <token>`
 *   - `Authorization: <token>`（`@astramai/core` 的 developerKey 就是这个形态）
 *   - `X-API-Key: <token>`
 */
function extractToken(req: IncomingMessage): string | undefined {
  const apiKey = req.headers['x-api-key'];
  const apiKeyValue = (Array.isArray(apiKey) ? apiKey[0] : apiKey)?.trim();
  if (apiKeyValue) return apiKeyValue;

  const auth = req.headers.authorization;
  const authValue = (Array.isArray(auth) ? auth[0] : auth)?.trim();
  if (!authValue) return undefined;

  const bearer = /^Bearer\s+(.+)$/i.exec(authValue);
  return (bearer?.[1] ?? authValue).trim();
}

/** 限流键：优先用 X-Forwarded-For 的第一段（经 frp 时会带上真实来源）。 */
function clientKeyOf(req: IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for'];
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (value) {
    const first = value.split(',')[0]?.trim();
    if (first) return first;
  }
  return req.socket.remoteAddress ?? 'unknown';
}
