/**
 * 极简 HTTP 工具层：路由、响应助手、静态文件服务。
 *
 * 刻意不引入 Web 框架——本测试站只需要 GET 路由与静态文件，
 * 零依赖意味着零版本漂移，也更容易审计密钥的流向。
 */

import { createReadStream, existsSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';

export interface RequestContext {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  params: Record<string, string>;
  query: URLSearchParams;
}

export type RouteHandler = (ctx: RequestContext) => Promise<void> | void;

interface Route {
  method: string;
  segments: string[];
  handler: RouteHandler;
}

export class Router {
  private readonly routes: Route[] = [];

  add(method: string, pattern: string, handler: RouteHandler): this {
    this.routes.push({
      method: method.toUpperCase(),
      segments: pattern.split('/').filter(Boolean),
      handler,
    });
    return this;
  }

  get(pattern: string, handler: RouteHandler): this {
    return this.add('GET', pattern, handler);
  }

  /** 匹配路由；命中时返回处理函数与路径参数。 */
  match(
    method: string,
    pathname: string,
  ): { handler: RouteHandler; params: Record<string, string> } | null {
    const parts = pathname.split('/').filter(Boolean);
    for (const route of this.routes) {
      if (route.method !== method.toUpperCase()) continue;
      if (route.segments.length !== parts.length) continue;

      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < route.segments.length; i += 1) {
        const segment = route.segments[i]!;
        const value = parts[i]!;
        if (segment.startsWith(':')) {
          params[segment.slice(1)] = decodeURIComponent(value);
        } else if (segment !== value) {
          ok = false;
          break;
        }
      }
      if (ok) return { handler: route.handler, params };
    }
    return null;
  }
}

// ── 响应助手 ────────────────────────────────────────────────────────────

export function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

export function sendText(res: ServerResponse, status: number, text: string): void {
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'content-length': Buffer.byteLength(text),
  });
  res.end(text);
}

/** 读取请求体（限制大小，避免测试站被塞爆内存）。 */
export async function readBody(req: IncomingMessage, limitBytes = 1_000_000): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > limitBytes) throw new Error('请求体过大');
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString('utf8');
}

// ── 静态文件 ────────────────────────────────────────────────────────────

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

export interface StaticOptions {
  /** 静态根目录。 */
  root: string;
  /** 未命中文件时回退到该文件（SPA 用），相对 root。 */
  spaFallback?: string;
}

/**
 * 尝试返回静态文件。命中返回 true，未命中返回 false 交给上层 404。
 * 已做路径穿越防护：解析后的绝对路径必须仍在 root 之内。
 */
export function serveStatic(
  res: ServerResponse,
  pathname: string,
  options: StaticOptions,
): boolean {
  const root = resolve(options.root);
  if (!existsSync(root)) return false;

  const decoded = safeDecode(pathname);
  const relative = normalize(decoded).replace(/^([/\\])+/, '');
  let target = resolve(join(root, relative));

  // 目录或未指定文件 → 回退
  if (!target.startsWith(root + sep) && target !== root) return false;

  if (existsSync(target) && statSync(target).isDirectory()) {
    target = join(target, 'index.html');
  }

  if (!existsSync(target) || !statSync(target).isFile()) {
    if (!options.spaFallback) return false;
    target = resolve(join(root, options.spaFallback));
    if (!existsSync(target)) return false;
  }

  const ext = extname(target).toLowerCase();
  const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';
  const size = statSync(target).size;

  const isHashed = /-[A-Za-z0-9_]{8,}\./.test(target);
  res.writeHead(200, {
    'content-type': contentType,
    'content-length': size,
    'cache-control': isHashed ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  createReadStream(target).pipe(res);
  return true;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
