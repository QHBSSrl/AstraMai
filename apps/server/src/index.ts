/**
 * AstraMai 测试站服务端入口。
 *
 * 启动后提供：
 *   - /api/*  落雪数据聚合接口
 *   - /*      前端构建产物（apps/web/dist，存在时才挂载）
 *
 * 默认只监听 127.0.0.1，避免把带密钥的服务暴露到局域网。
 */

import { existsSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { assertDeploymentSafety, readConfig } from './config.js';
import { createGuard } from './guard.js';
import { sendJson, serveStatic } from './http.js';
import { LxnsService } from './lxns-service.js';
import { createRouter, notFound } from './routes.js';

const config = readConfig();

// 安全校验放在建服务之前：绑公网却不带令牌就别启动了
assertDeploymentSafety(config);

const service = new LxnsService(config);
const guard = createGuard(config);
const router = createRouter(service, config, guard);
const hasWebDist = existsSync(config.webDist);

/** 仅对本地来源放开 CORS；其他来源不下发 CORS 头，浏览器会自行拦截。 */
function applyCors(req: IncomingMessage, res: ServerResponse): void {
  const origin = req.headers.origin;
  if (!origin) return;
  try {
    const parsed = new URL(origin);
    const isLocal =
      parsed.hostname === 'localhost' ||
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname === '[::1]' ||
      parsed.hostname === '::1';
    if (!isLocal) return;
  } catch {
    return;
  }
  res.setHeader('access-control-allow-origin', origin);
  res.setHeader('vary', 'origin');
  res.setHeader('access-control-allow-headers', 'content-type,x-lxns-key');
  res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
}

const server = createServer((req, res) => {
  applyCors(req, res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const method = req.method ?? 'GET';

  // 门禁放在路由之前，保证不会有哪条新路由漏掉检查
  const access = guard.check(req, url.pathname);
  if (!access.ok) {
    sendJson(res, access.status, {
      ok: false,
      success: false,
      message: access.message,
      error: {
        kind: access.status === 429 ? 'rate-limited' : 'unauthorized',
        friendlyMessage: access.message,
        status: access.status,
        endpoint: url.pathname,
      },
    });
    return;
  }

  const matched = router.match(method, url.pathname);
  if (matched) {
    try {
      const result = matched.handler({
        req,
        res,
        url,
        params: matched.params,
        query: url.searchParams,
      });
      if (result instanceof Promise) {
        result.catch((error: unknown) => {
          console.error('[AstraMai] 处理请求出错：', error);
          if (!res.headersSent) {
            res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ ok: false, error: { kind: 'server', friendlyMessage: '服务端内部错误。' } }));
          } else {
            res.end();
          }
        });
      }
    } catch (error) {
      console.error('[AstraMai] 处理请求出错：', error);
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: { kind: 'server', friendlyMessage: '服务端内部错误。' } }));
      }
    }
    return;
  }

  if (method === 'GET' && !url.pathname.startsWith('/api/') && hasWebDist) {
    if (serveStatic(res, url.pathname, { root: config.webDist, spaFallback: 'index.html' })) return;
  }

  notFound(res, url.pathname);
});

server.on('clientError', (_error, socket) => {
  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
});

server.listen(config.port, config.host, () => {
  const base = `http://${config.host}:${config.port}`;
  console.log('');
  console.log('  AstraMai 测试站服务端已启动');
  console.log(`  ├─ 监听地址   ${base}`);
  console.log(`  ├─ 数据模式   ${describeMode()}`);
  console.log(`  ├─ 服务端密钥 ${config.apiKey ? '已配置（仅服务端持有）' : '未配置'}`);
  console.log(`  ├─ 页面填密钥 ${config.allowClientKey ? '允许（仅本地测试）' : '禁止'}`);
  console.log(
    `  ├─ 访问门禁   ${
      config.apiTokens.length > 0
        ? `已要求访问令牌（${config.apiTokens.length} 个）`
        : '⚠ 未设访问令牌 —— 仅限本机使用，切勿直接暴露到公网'
    }`,
  );
  console.log(
    `  ├─ 上游预算   ${
      config.upstreamLimitPerMinute > 0
        ? `${config.upstreamLimitPerMinute} 次/分钟（全局，保护开发者密钥配额）`
        : '已关闭'
    }`,
  );
  console.log(
    `  ├─ 限流       ${config.rateLimitPerMinute > 0 ? `${config.rateLimitPerMinute} 次/分钟/IP` : '已关闭'}`,
  );
  console.log(`  ├─ 曲库缓存   ${Math.round(config.songCacheTtlMs / 1000)} 秒`);
  console.log(`  └─ 前端产物   ${hasWebDist ? config.webDist : '未构建（开发模式请另开 vite）'}`);
  console.log('');
});

function describeMode(): string {
  if (config.modeConfig === 'mock') return 'mock（强制模拟数据）';
  if (config.modeConfig === 'live') return 'live（强制真实接口）';
  return config.apiKey ? 'auto → live（已配置密钥）' : 'auto → mock（无密钥，自动降级）';
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    console.log(`\n[AstraMai] 收到 ${signal}，正在关闭…`);
    server.close(() => process.exit(0));
    // 兜底：3 秒内没关干净就强退
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
