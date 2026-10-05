/**
 * 服务端配置：读取 .env，解析落雪密钥与运行模式。
 *
 * 密钥只在服务端存在，绝不下发到浏览器；浏览器只在「本地测试」场景下
 * 通过 `x-lxns-key` 头临时递交密钥，由服务端转发，不落盘、不记录。
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 仓库根目录（从 apps/server/src 或 apps/server/dist 上溯三层）。 */
export function repoRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..', '..', '..');
}

let envLoaded = false;

/** 加载仓库根目录下的 .env（不存在则忽略）。 */
export function loadEnv(): void {
  if (envLoaded) return;
  envLoaded = true;
  const candidates = [resolve(repoRoot(), '.env'), resolve(process.cwd(), '.env')];
  const loader = (process as unknown as { loadEnvFile?: (path?: string) => void }).loadEnvFile;
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    try {
      if (typeof loader === 'function') {
        loader.call(process, file);
      } else {
        loadEnvManually(file);
      }
    } catch {
      // .env 有问题不应该阻止服务启动
    }
    break;
  }
}

function loadEnvManually(file: string): void {
  // Node 20.12 以下没有 loadEnvFile 时的兜底
  const text = readFileSync(file, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

export type LxnsMode = 'live' | 'mock';
export type LxnsModeConfig = 'auto' | 'live' | 'mock';

export interface ServerConfig {
  host: string;
  port: number;
  /** 配置里写的模式。 */
  modeConfig: LxnsModeConfig;
  /** 服务端持有的开发者密钥。 */
  apiKey: string | undefined;
  /** 是否允许浏览器临时递交密钥。 */
  allowClientKey: boolean;
  songCacheTtlMs: number;
  repoRoot: string;
  /** 前端构建产物目录。 */
  webDist: string;
}

export function readConfig(): ServerConfig {
  loadEnv();
  const modeRaw = (process.env.LXNS_MODE ?? 'auto').trim().toLowerCase();
  const modeConfig: LxnsModeConfig =
    modeRaw === 'live' || modeRaw === 'mock' ? modeRaw : 'auto';

  const ttlSeconds = Number.parseInt(process.env.SONG_CACHE_TTL ?? '', 10);

  return {
    host: process.env.HOST?.trim() || '127.0.0.1',
    port: Number.parseInt(process.env.PORT ?? '8787', 10) || 8787,
    modeConfig,
    apiKey: process.env.LXNS_API_KEY?.trim() || undefined,
    allowClientKey: (process.env.ALLOW_CLIENT_KEY ?? 'true').trim().toLowerCase() !== 'false',
    songCacheTtlMs: (Number.isFinite(ttlSeconds) && ttlSeconds > 0 ? ttlSeconds : 21_600) * 1000,
    repoRoot: repoRoot(),
    webDist: resolve(repoRoot(), 'apps', 'web', 'dist'),
  };
}

/**
 * 决定实际数据模式。
 * 显式 `live` 但缺密钥时直接抛错——宁可启动失败，也不要静默给出假数据。
 */
export function resolveMode(config: ServerConfig, hasClientKey: boolean): LxnsMode {
  if (config.modeConfig === 'mock') return 'mock';
  const hasKey = hasClientKey || config.apiKey !== undefined;
  if (config.modeConfig === 'live') {
    if (!hasKey) {
      throw new Error(
        'LXNS_MODE=live 但没有任何开发者密钥。请在 .env 中设置 LXNS_API_KEY，或在页面上临时填入密钥。',
      );
    }
    return 'live';
  }
  return hasKey ? 'live' : 'mock';
}
