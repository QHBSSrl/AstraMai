/**
 * 数据源注册表。
 *
 * 服务端只认这里注册过的源。新增一个源 = 实现 `DataSource` + 在这里 register，
 * 不需要动路由、也不需要动客户端。
 *
 * 每个源持有**自己**的上游预算计数器（各上游配额独立，共用一个会让彼此拖死）。
 */

import { LxnsError } from '@astramai/core';

import { UpstreamLimiter, type UpstreamStatus } from './upstream-limiter.js';
import type { DataSource, SourceDescriptor } from './types.js';

export class SourceRegistry {
  private readonly sources = new Map<string, DataSource>();
  private readonly limiters = new Map<string, UpstreamLimiter>();
  private defaultId = '';

  constructor(private readonly upstreamLimitPerMinute: number) {}

  /**
   * 取某个源的上游限流器，不存在则创建。
   *
   * 需要在 `register` **之前**就能拿到（源的构造函数要持有它），
   * 所以这里按需创建，而不是要求先注册。
   */
  limiterFor(id: string): UpstreamLimiter {
    const existing = this.limiters.get(id);
    if (existing) return existing;
    const created = new UpstreamLimiter(this.upstreamLimitPerMinute);
    this.limiters.set(id, created);
    return created;
  }

  /**
   * 注册一个源。
   * 第一个注册的自动成为默认源——这样配置里不用额外写一遍默认值。
   */
  register(source: DataSource, makeDefault = false): void {
    this.sources.set(source.id, source);
    this.limiterFor(source.id);
    if (makeDefault || this.defaultId === '') this.defaultId = source.id;
  }

  /** 指定默认源；id 不存在时抛错，避免把拼写错误藏起来。 */
  setDefault(id: string): void {
    if (!this.sources.has(id)) {
      throw new Error(`默认数据源 ${id} 未注册，可用的有：${[...this.sources.keys()].join(', ')}`);
    }
    this.defaultId = id;
  }

  /**
   * 取一个源。
   * 不传 id 用默认源；传了但不认识就抛 `bad-request`，让调用方知道是参数问题。
   */
  get(id?: string | undefined): DataSource {
    const wanted = (id ?? '').trim() || this.defaultId;
    const source = this.sources.get(wanted);
    if (!source) {
      throw new LxnsError('bad-request', `未知的数据源：${wanted}`, {
        friendly: `未知的数据源「${wanted}」。可用：${[...this.sources.keys()].join('、')}。`,
      });
    }
    return source;
  }

  /** 供 `/api/v1/sources` 展示。不可用的源也会列出，并说明原因。 */
  list(): SourceDescriptor[] {
    return [...this.sources.values()].map((source) => ({
      ...source.describe(),
      isDefault: source.id === this.defaultId,
    })) as (SourceDescriptor & { isDefault: boolean })[];
  }

  defaultSourceId(): string {
    return this.defaultId;
  }

  /** 每个源的上游预算余量，供健康检查展示。 */
  upstreamStatus(): Record<string, UpstreamStatus> {
    const out: Record<string, UpstreamStatus> = {};
    for (const [id, limiter] of this.limiters) out[id] = limiter.status();
    return out;
  }

  /** 全部源加起来的预算余量——健康检查里最常看的那个数。 */
  totalRemaining(): number {
    let total = 0;
    for (const limiter of this.limiters.values()) {
      const remaining = limiter.status().remaining;
      if (!Number.isFinite(remaining)) return Number.POSITIVE_INFINITY;
      total += remaining;
    }
    return total;
  }
}
