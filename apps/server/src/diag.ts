/**
 * 端上报的诊断信息。
 *
 * 存在的理由很具体：**真机拿不到日志**。
 * Vela 的官方「真机调试」只支持 Xiaomi Watch S4 且仅对合作方开放，
 * 普通手表既没有调试小尾巴也连不上 AIoT-IDE。手表上出了闪退，
 * 开发者手上什么都没有。
 *
 * 折中办法：让 App 自己把关键节点和错误打回服务端。
 * 好处是不依赖任何平台工具；代价是**如果是原生崩溃（比如 OOM），
 * 可能来不及上报**——但那时至少能看到「最后走到了哪一步」。
 *
 * 内存里只留最近若干条，避免被刷爆；同时落一份文件便于事后翻。
 */

import { appendFileSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface DiagEntry {
  /** 服务端收到的时刻。 */
  at: string;
  /** 来源 IP，用来区分是哪个设备。 */
  from: string;
  /** 事件名，例如 page:onInit / app:onError。 */
  event: string;
  /** 可读消息。 */
  message: string;
  /** 出错时的堆栈。 */
  stack: string;
  /** 其它上下文，字符串化后存。 */
  extra: string;
}

const MAX_ENTRIES = 300;
/** 日志文件上限；超过就清空重来，避免被刷爆磁盘。 */
const MAX_FILE_BYTES = 1024 * 1024;
/** 每写这么多次检查一次文件大小——每次都 stat 太浪费。 */
const SIZE_CHECK_EVERY = 50;

export class DiagStore {
  private readonly entries: DiagEntry[] = [];
  private readonly logFile: string;
  private writes = 0;

  constructor(private readonly repoRoot: string) {
    this.logFile = resolve(repoRoot, 'apps', 'server', 'diag.log');
    try {
      mkdirSync(resolve(repoRoot, 'apps', 'server'), { recursive: true });
    } catch {
      // 目录已存在或被限制，落文件失败不影响内存里那份
    }
  }

  record(input: Omit<DiagEntry, 'at'>): DiagEntry {
    const entry: DiagEntry = { at: new Date().toISOString(), ...input };
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) this.entries.shift();

    // 落文件失败不该影响接口——诊断功能本身不能成为新的故障点
    try {
      this.writes += 1;
      if (this.writes % SIZE_CHECK_EVERY === 0) {
        try {
          if (statSync(this.logFile).size > MAX_FILE_BYTES) writeFileSync(this.logFile, '', 'utf8');
        } catch {
          // 文件还不存在，appendFileSync 会创建
        }
      }
      appendFileSync(this.logFile, `${JSON.stringify(entry)}\n`, 'utf8');
    } catch {
      // 忽略
    }
    return entry;
  }

  /** 最近若干条。`since` 用于只看某个时间点之后的。 */
  list(since?: string, limit = 200): DiagEntry[] {
    const slice = since ? this.entries.filter((e) => e.at > since) : this.entries;
    return slice.slice(-Math.min(Math.max(limit, 1), MAX_ENTRIES));
  }

  clear(): number {
    const count = this.entries.length;
    this.entries.length = 0;
    return count;
  }

  get file(): string {
    return this.logFile;
  }
}
