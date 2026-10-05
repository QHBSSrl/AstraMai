/**
 * 上游预算：限制「每个数据源每分钟最多被真实请求多少次」。
 *
 * 为什么必须有它：这个服务端是**公开给大家用**的，客户端里带的令牌解出来就能用，
 * 所以用量无法靠令牌约束。一旦有人写脚本刷，烧的是我们自己的开发者密钥配额，
 * 上游会直接返回 429。这一层与「有多少客户端」无关。
 *
 * 为什么按源分开：不同上游的配额是**各自的**。落雪被限了不代表另一个源也被限，
 * 共用一个计数器会让一个源把另一个源拖死。
 *
 * 只统计真正打到上游的请求——命中缓存的调用不应消耗预算。
 */

import { LxnsError } from '@astramai/core';

export interface UpstreamStatus {
  limitPerMinute: number;
  usedThisMinute: number;
  remaining: number;
}

export class UpstreamLimiter {
  private window = { count: 0, resetAt: 0 };

  constructor(private readonly limitPerMinute: number) {}

  /**
   * 预支额度，不足时抛错。
   *
   * 故意在**发起请求之前**调用：这样超限时我们直接拒绝，不会给上游造成压力。
   */
  spend(count: number, sourceLabel: string): void {
    if (this.limitPerMinute <= 0) return;

    const now = Date.now();
    if (now >= this.window.resetAt) {
      this.window = { count: 0, resetAt: now + 60_000 };
    }
    if (this.window.count + count > this.limitPerMinute) {
      throw new LxnsError(
        'rate-limited',
        `${sourceLabel} 上游调用已达每分钟 ${this.limitPerMinute} 次上限`,
        {
          friendly: `当前使用人数较多，服务器对${sourceLabel}的调用已达每分钟上限，请过一会儿再试。`,
        },
      );
    }
    this.window.count += count;
  }

  status(): UpstreamStatus {
    const now = Date.now();
    const used = now >= this.window.resetAt ? 0 : this.window.count;
    return {
      limitPerMinute: this.limitPerMinute,
      usedThisMinute: used,
      remaining: this.limitPerMinute <= 0 ? Number.POSITIVE_INFINITY : Math.max(0, this.limitPerMinute - used),
    };
  }
}
