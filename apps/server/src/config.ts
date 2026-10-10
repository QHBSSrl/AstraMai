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
export type AuthMode = 'open' | 'key';

export interface ServerConfig {
  host: string;
  port: number;
  /** 配置里写的模式。 */
  modeConfig: LxnsModeConfig;
  /** 服务端持有的开发者密钥。 */
  apiKey: string | undefined;
  /**
   * Phigros 开放平台密钥（`X-OpenApi-Token`）。
   *
   * 和落雪密钥并列而不是复用：**这是两个不同的平台**，
   * 密钥不通用，配置也应该能分别开关。
   */
  phigrosApiKey: string | undefined;
  /** 是否允许浏览器临时递交密钥。 */
  allowClientKey: boolean;
  /**
   * 访问本服务的共享令牌。配置后，除 /api/health 外的所有 /api/* 都要求带令牌。
   *
   * 支持多个（`API_TOKENS` 逗号分隔），这样发给不同的人可以用不同的口令，
   * 某一个泄露了单独停用即可，不必让所有人的口令一起失效。
   *
   * ⚠️ 但要清楚：**令牌一旦写进客户端（比如手表 App 的包），就不再是秘密**——
   * 谁拿到 App 都能解出来。所以这道闸挡的是随机扫描器，不是拿到 App 的人。
   * 真正保护落雪密钥配额的是 `upstreamLimitPerMinute`。
   */
  apiTokens: string[];
  /**
   * 鉴权模式。
   *
   *   `key` —— 需要访问令牌（默认，适合私有部署）
   *   `open` —— 不校验令牌，**面向公开分发的 App**
   *
   * 为什么要 `open`：这个软件是开放给大家用的，令牌写进客户端包里就不再是秘密，
   * 谁拿到 App 都能解出来。那种情况下把令牌当门禁只是自欺欺人，
   * 真正的控制手段是限流（`RATE_LIMIT_PER_MINUTE` + `UPSTREAM_LIMIT_PER_MINUTE`）。
   *
   * ⚠️ `open` 模式下任何人都能用我们这台服务器查分，消耗的是我们的开发者密钥配额。
   * 只在上游配额谈妥之后再用。
   */
  authMode: AuthMode;
  /**
   * 全局上游预算：每分钟最多向**每个**数据源发起多少次请求，与有多少客户端无关。
   *
   * 存在的理由：公开分发的 App 里的令牌拦不住用量；一旦有人写脚本刷，
   * 烧的是我们自己的开发者密钥配额（上游会返回 429）。
   * 设为 0 表示不限。
   */
  upstreamLimitPerMinute: number;
  /** 每个来源 IP 每分钟允许的请求数；0 表示不限流。 */
  rateLimitPerMinute: number;
  songCacheTtlMs: number;
  repoRoot: string;
  /** 前端构建产物目录。 */
  webDist: string;
  /** 是否绑定在非回环地址上（即对外可达）。 */
  isPublicBind: boolean;
}

/** 判断 host 是否只对本机可达。 */
export function isLoopbackHost(host: string): boolean {
  const value = host.trim().toLowerCase();
  return value === '127.0.0.1' || value === 'localhost' || value === '::1' || value === '[::1]';
}

/**
 * 解析令牌列表。
 *
 * `API_TOKENS` 支持逗号或换行分隔的多个令牌，`API_TOKEN` 作为单令牌的兼容写法。
 * 去重并丢掉空白项，避免 `a,,b` 这种输入产生一个空令牌——那会让任何人都能通过。
 */
export function parseTokenList(multi: string | undefined, single: string | undefined): string[] {
  const raw = [multi ?? '', single ?? ''].join(',');
  const tokens = raw
    .split(/[,\n]/)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  return [...new Set(tokens)];
}

/**
 * 部署安全校验。
 *
 * 这个服务端持有开发者密钥，一旦对外可达却没有任何约束，
 * 等于把密钥和配额开放给所有人。所以这里**直接让进程起不来**，
 * 而不是打一行警告了事——警告在 systemd/docker 的日志里没人看。
 */
export function assertDeploymentSafety(config: ServerConfig): void {
  if (!config.isPublicBind) return;

  // 公开模式：不校验令牌，但必须至少有一道限流兜底
  if (config.authMode === 'open') {
    if (config.rateLimitPerMinute <= 0 && config.upstreamLimitPerMinute <= 0) {
      throw new Error(
        [
          `拒绝启动：AUTH_MODE=open 且两道限流都是关闭的（HOST=${config.host} 对外可达）。`,
          '那意味着任何人都能无限次用我们的开发者密钥查分。',
          '请至少设置 RATE_LIMIT_PER_MINUTE（按来源 IP）或 UPSTREAM_LIMIT_PER_MINUTE（全局上游预算）。',
        ].join('\n'),
      );
    }
    console.warn(
      '[AstraMai] AUTH_MODE=open：不校验访问令牌，任何知道地址的人都能调用。' +
        `当前靠限流兜底（每 IP ${config.rateLimitPerMinute} 次/分钟，` +
        `上游预算 ${config.upstreamLimitPerMinute} 次/分钟）。` +
        '请确认上游配额已经谈妥。',
    );
    return;
  }

  if (config.apiTokens.length === 0) {
    throw new Error(
      [
        `拒绝启动：HOST=${config.host} 对外可达，但没有设置任何访问令牌。`,
        '该服务端持有开发者密钥，无令牌暴露到公网等于把密钥公开。',
        '请设置 API_TOKENS（可用逗号分隔多个）或 API_TOKEN，然后重启。',
        '如果这是要公开分发给大家用的服务，请显式设置 AUTH_MODE=open 并配好限流。',
        '（生成示例：node -e "console.log(require(\'crypto\').randomBytes(24).toString(\'base64url\'))"）',
      ].join('\n'),
    );
  }

  if (config.allowClientKey) {
    console.warn(
      '[AstraMai] 警告：对外可达且 ALLOW_CLIENT_KEY 未关闭，' +
        '任何客户端都可以递交自己的密钥。生产环境建议设为 false。',
    );
  }
}

export function readConfig(): ServerConfig {
  loadEnv();
  const modeRaw = (process.env.LXNS_MODE ?? 'auto').trim().toLowerCase();
  const modeConfig: LxnsModeConfig =
    modeRaw === 'live' || modeRaw === 'mock' ? modeRaw : 'auto';

  const ttlSeconds = Number.parseInt(process.env.SONG_CACHE_TTL ?? '', 10);
  const rateLimit = Number.parseInt(process.env.RATE_LIMIT_PER_MINUTE ?? '', 10);
  const upstreamLimit = Number.parseInt(process.env.UPSTREAM_LIMIT_PER_MINUTE ?? '', 10);
  const host = process.env.HOST?.trim() || '127.0.0.1';

  return {
    host,
    port: Number.parseInt(process.env.PORT ?? '8787', 10) || 8787,
    modeConfig,
    apiKey: process.env.LXNS_API_KEY?.trim() || undefined,
  phigrosApiKey: process.env.PHIGROS_API_KEY?.trim() || undefined,
    allowClientKey: (process.env.ALLOW_CLIENT_KEY ?? 'true').trim().toLowerCase() !== 'false',
    apiTokens: parseTokenList(process.env.API_TOKENS, process.env.API_TOKEN),
    authMode: (process.env.AUTH_MODE ?? '').trim().toLowerCase() === 'open' ? 'open' : 'key',
    upstreamLimitPerMinute:
      Number.isFinite(upstreamLimit) && upstreamLimit >= 0 ? upstreamLimit : 150,
    rateLimitPerMinute: Number.isFinite(rateLimit) && rateLimit >= 0 ? rateLimit : 120,
    songCacheTtlMs: (Number.isFinite(ttlSeconds) && ttlSeconds > 0 ? ttlSeconds : 21_600) * 1000,
    repoRoot: repoRoot(),
    webDist: resolve(repoRoot(), 'apps', 'web', 'dist'),
    isPublicBind: !isLoopbackHost(host),
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
