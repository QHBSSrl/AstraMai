/**
 * 客户端错误日志归档。
 *
 * ── 产品决策（用户定的规则）────────────────────────────────────────
 *
 * **只上传报错项目，以及它前后各 3 分钟的日志。**
 *
 * 不传全量日志的理由很直接：
 *   · 手表存储小、流量贵
 *   · 全量日志里迟早会混进好友码、QQ 号、凭证片段
 *   · 没人会去看 99% 的正常日志
 *
 * ── 与 diag 的区别 ──────────────────────────────────────────────────
 *
 * `diag.ts` 是「一条一条打点」，用来判断崩溃发生在哪一步。
 * 这里是「一次事故一个包」，用来事后复盘 —— 带上下文，能看出前因后果。
 *
 * 两者都保留：diag 看「最后走到哪」，这里看「出事前后发生了什么」。
 *
 * ── 存储 ────────────────────────────────────────────────────────────
 *
 * 落盘到 `data/logs/YYYY-MM-DD/<id>.json`，按天分目录，默认留 14 天。
 * 用户说以后会单独给一台机器放日志，到时候把 `writeReport` 换成转发即可。
 */

import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

/** 日志保留天数。 */
const KEEP_DAYS = 14;

/** 单条日志的最大长度（字符）。 */
const MAX_LINE = 800;

/** 一个包最多多少条 —— 3 分钟通常几十条，给到 500 是防刷。 */
const MAX_ENTRIES = 500;

/** 单个包的最大字节数。 */
const MAX_BYTES = 256 * 1024;

export interface LogEntry {
  /** 客户端本地时间戳（毫秒）。 */
  t: number;
  /** 级别：log / warn / error / mark */
  lv: string;
  /** 内容。 */
  m: string;
}

export interface LogReport {
  /** 匿名设备标识（客户端自己生成的随机串，不是硬件 ID）。 */
  device?: string;
  /** 出错的页面 / 模块。 */
  scope?: string;
  /** 错误消息。 */
  message?: string;
  /** 堆栈。 */
  stack?: string;
  /** 事故的参考时刻（客户端的 Date.now()）。 */
  at?: number;
  /** 日志窗口。 */
  entries: LogEntry[];
  /** 这个包是「出事前」还是「出事后补的」。 */
  phase?: 'before' | 'after' | 'both';
}

export interface StoredReport {
  /** 服务端收到的时刻。 */
  receivedAt: string;
  /** 来源 IP（运维排查用，不对外展示）。 */
  from: string;
  /** 客户端上报的内容。 */
  report: LogReport;
}

export class LogStore {
  private readonly dir: string;

  constructor(repoRoot: string) {
    // 同 usage.ts：/app 不可写，/app/apps 才是 777
    this.dir = resolve(repoRoot, 'apps', 'server', 'data', 'logs');
  }

  /**
   * 存一个包。返回是否成功。
   *
   * ⚠️ 所有校验都在这里做 —— 客户端可能被改，不能信它的大小。
   */
  save(report: LogReport, from: string): { ok: boolean; id?: string; reason?: string } {
    try {
      // 裁剪 + 截断
      const entries = (Array.isArray(report.entries) ? report.entries : [])
        .slice(-MAX_ENTRIES)
        .map((e) => ({
          t: Number(e && e.t) || 0,
          lv: String((e && e.lv) || 'log').slice(0, 8),
          m: String((e && e.m) || '').slice(0, MAX_LINE),
        }));

      if (entries.length === 0) {
        return { ok: false, reason: 'empty' };
      }

      const cleaned: LogReport = {
        device: String(report.device || '').slice(0, 40),
        scope: String(report.scope || '').slice(0, 80),
        message: String(report.message || '').slice(0, 1000),
        stack: String(report.stack || '').slice(0, 8000),
        at: Number(report.at) || 0,
        phase: report.phase === 'after' ? 'after' : report.phase === 'both' ? 'both' : 'before',
        entries,
      };

      const payload: StoredReport = {
        receivedAt: new Date().toISOString(),
        from,
        report: cleaned,
      };

      const json = JSON.stringify(payload);
      if (json.length > MAX_BYTES) {
        return { ok: false, reason: 'too-large' };
      }

      const day = payload.receivedAt.slice(0, 10);
      const dayDir = resolve(this.dir, day);
      mkdirSync(dayDir, { recursive: true });

      const id = randomUUID();
      writeFileSync(resolve(dayDir, `${id}.json`), json, 'utf8');

      this.prune();
      return { ok: true, id };
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : 'unknown' };
    }
  }

  /** 某个设备最近几个包，便于「同一台设备反复出错」的排查。 */
  recent(device: string, limit = 20): string[] {
    try {
      if (!device) return [];
      const days = readdirSync(this.dir).sort().reverse().slice(0, 3);
      const hits: string[] = [];
      // 这里只返回文件名，具体内容用 cat 看 —— 避免把 reader 写得太重
      for (const d of days) {
        for (const f of readdirSync(resolve(this.dir, d))) {
          if (hits.length >= limit) return hits;
          hits.push(`${d}/${f}`);
        }
      }
      return hits;
    } catch {
      return [];
    }
  }

  /** 删过期目录。 */
  private prune(): void {
    try {
      const cutoff = new Date(Date.now() - KEEP_DAYS * 86_400_000).toISOString().slice(0, 10);
      for (const name of readdirSync(this.dir)) {
        if (name.length === 10 && name < cutoff) {
          rmSync(resolve(this.dir, name), { recursive: true, force: true });
        }
      }
    } catch {
      // 清不掉下次再清
    }
  }
}
