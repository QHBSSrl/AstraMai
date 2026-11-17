/**
 * 用量统计。
 *
 * ── 为什么需要 ──────────────────────────────────────────────────────
 *
 * 1100 多个下载，但**完全不知道有多少人在用**：
 *
 *   · 用户的 App 连的是裸 IP，流量从来没经过 Cloudflare
 *   · 容器日志只打启动配置，不记请求
 *   · diag 通道只有报错，没错误就是空的
 *
 * 所以加一个最小的统计：**每天多少个不同的客户端、多少次请求**。
 *
 * ── 刻意不做的事 ────────────────────────────────────────────────────
 *
 * · **不存原始 IP**，只存 sha256 前 12 位。够用来去重，不够用来定位人。
 * · **不引入数据库**。一天一个 JSON 文件，30 天自动清。
 * · **不阻塞请求**。计数失败就跳过，绝不因为统计把请求搞挂。
 *
 * ⚠️ 哈希是不加盐的 —— 拿常见 IPv4 地址空间做字典理论上能反查。
 * 但这只是量级统计，对手头这点流量不值得加盐（加盐就要持久化盐，
 * 反而多一个状态）。真要更严，把 SALT 从环境变量读进来即可。
 */

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';

/** 保留多少天。 */
const KEEP_DAYS = 30;

/** 落盘间隔（毫秒）—— 别每个请求都写盘。 */
const FLUSH_INTERVAL_MS = 30_000;

interface DayBucket {
  date: string;
  /** 客户端哈希集合，用来去重。 */
  clients: string[];
  requests: number;
  /** 按路径粗分，看哪个接口最热。 */
  paths: Record<string, number>;
}

export interface UsageToday {
  date: string;
  uniqueClients: number;
  requests: number;
  paths: Record<string, number>;
}

function today(): string {
  // UTC 日界。国内用户会看到「今天」从早上 8 点开始，够用了。
  return new Date().toISOString().slice(0, 10);
}

function hashClient(ip: string): string {
  return createHash('sha256').update(ip).digest('hex').slice(0, 12);
}

export class UsageStore {
  private readonly dir: string;
  private bucket: DayBucket;
  private readonly clients = new Set<string>();
  private dirty = false;
  private lastFlush = 0;

  constructor(repoRoot: string) {
    /*
     * 目录放在 pps/server/data/ 下 —— 容器里 /app 是 root 所有、/app/apps 才是 777。
     * 放到 /app/data 会 mkdir: Permission denied，而 writeFileSync 的异常被
     * catch 吞掉后**统计会永远显示 0**，看起来像「没人用」。
     *
     * 和 diag.ts 落在同一个可写目录，保持一致。
     */
    this.dir = resolve(repoRoot, 'apps', 'server', 'data', 'usage');
    this.bucket = { date: today(), clients: [], requests: 0, paths: {} };
    this.load();
  }

  /** 从磁盘读今天的桶（服务重启不丢）。 */
  private load(): void {
    try {
      const file = resolve(this.dir, `${this.bucket.date}.json`);
      if (!existsSync(file)) return;
      const raw = JSON.parse(readFileSync(file, 'utf8')) as DayBucket;
      if (raw && raw.date === this.bucket.date) {
        this.bucket = raw;
        for (const c of raw.clients) this.clients.add(c);
      }
    } catch {
      // 读失败就当今天从零开始，不报错
    }
  }

  /**
   * 记一次请求。
   *
   * @param ip      来源地址（可以是空字符串）
   * @param path    请求路径，用于粗分热度
   */
  record(ip: string, path: string): void {
    try {
      const now = Date.now();
      const date = today();

      // 跨天了就结算旧的、开新的
      if (date !== this.bucket.date) {
        this.flush(true);
        this.clients.clear();
        this.bucket = { date, clients: [], requests: 0, paths: {} };
      }

      this.bucket.requests += 1;
      if (this.clients.size < 50_000 && ip) {
        this.clients.add(hashClient(ip));
      }

      /*
       * 路径只记前两段（如 /api/v1），避免把带好友码的 URL 全记下来 ——
       * 那样等于把用户 ID 存进统计里了。
       */
      const coarse = coarsePath(path);
      this.bucket.paths[coarse] = (this.bucket.paths[coarse] ?? 0) + 1;

      this.dirty = true;
      if (now - this.lastFlush > FLUSH_INTERVAL_MS) {
        this.flush(false);
      }
    } catch {
      // 统计不许影响主流程
    }
  }

  /** 写盘 + 清理过期文件。 */
  private flush(force: boolean): void {
    if (!this.dirty && !force) return;
    try {
      mkdirSync(this.dir, { recursive: true });
      const snapshot: DayBucket = {
        date: this.bucket.date,
        clients: [...this.clients],
        requests: this.bucket.requests,
        paths: this.bucket.paths,
      };
      writeFileSync(
        resolve(this.dir, `${snapshot.date}.json`),
        JSON.stringify(snapshot),
        'utf8',
      );
      this.dirty = false;
      this.lastFlush = Date.now();
      this.prune();
    } catch {
      // 磁盘满了也不许炸
    }
  }

  /** 删掉超过 KEEP_DAYS 的文件。 */
  private prune(): void {
    try {
      const cutoff = new Date(Date.now() - KEEP_DAYS * 86_400_000).toISOString().slice(0, 10);
      for (const name of readdirSync(this.dir)) {
        if (!name.endsWith('.json')) continue;
        const date = name.slice(0, -5);
        if (date < cutoff) rmSync(resolve(this.dir, name), { force: true });
      }
    } catch {
      // 清不掉就算了，下次再清
    }
  }

  /** 给 /api/health 用：今天 + 最近 7 天。 */
  status(): { today: UsageToday; last7d: Array<{ date: string; uniqueClients: number; requests: number }> } {
    this.flush(true);

    const result: Array<{ date: string; uniqueClients: number; requests: number }> = [];
    for (let i = 0; i < 7; i += 1) {
      const d = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
      try {
        const file = resolve(this.dir, `${d}.json`);
        if (!existsSync(file)) {
          result.push({ date: d, uniqueClients: 0, requests: 0 });
          continue;
        }
        const raw = JSON.parse(readFileSync(file, 'utf8')) as DayBucket;
        result.push({
          date: d,
          uniqueClients: Array.isArray(raw.clients) ? raw.clients.length : 0,
          requests: raw.requests ?? 0,
        });
      } catch {
        result.push({ date: d, uniqueClients: 0, requests: 0 });
      }
    }

    const t = result[0] ?? { date: today(), uniqueClients: 0, requests: 0 };
    return {
      today: {
        date: t.date,
        uniqueClients: t.uniqueClients,
        requests: t.requests,
        paths: this.bucket.paths,
      },
      last7d: result,
    };
  }
}

/** 路径收敛到前两段，避免把好友码写进统计。 */
function coarsePath(path: string): string {
  const parts = path.split('/').filter(Boolean);
  if (parts.length === 0) return '/';
  if (parts[0] === 'api' && parts[1]) return `/${parts[0]}/${parts[1]}`;
  return `/${parts[0]}`;
}
