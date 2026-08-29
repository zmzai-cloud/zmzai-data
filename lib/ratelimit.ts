// token bucket 限频：每个数据源一个桶，尊重源站速率。
//
// 实现：桶容量 = 每秒补充速率（burst 上限），按时间连续补充令牌；
// acquire() 在令牌不足时等待（带上限），超时直接拒绝而不是无限排队。

import { ProviderError } from "./providers/interface";

interface BucketOpts {
  /** 每秒补充的令牌数 */
  refillPerSec: number;
  /** 桶容量（burst）；默认 = refillPerSec，至少 1 */
  capacity?: number;
  /** acquire 最长等待时间（ms），超过则抛 RATE_LIMITED */
  maxWaitMs?: number;
}

export class TokenBucket {
  private tokens: number;
  private readonly capacity: number;
  private readonly refillPerSec: number;
  private readonly maxWaitMs: number;
  private lastRefill: number;

  constructor(opts: BucketOpts) {
    this.refillPerSec = Math.max(0.01, opts.refillPerSec);
    this.capacity = Math.max(1, opts.capacity ?? Math.max(1, this.refillPerSec));
    this.maxWaitMs = opts.maxWaitMs ?? 5_000;
    this.tokens = this.capacity;
    this.lastRefill = Date.now();
  }

  /** 立即取一个令牌，成功返回 true（不等待） */
  tryTake(n = 1): boolean {
    this.refill();
    if (this.tokens >= n) {
      this.tokens -= n;
      return true;
    }
    return false;
  }

  /** 取一个令牌，必要时等待；超过 maxWaitMs 抛 RATE_LIMITED */
  async acquire(scope = "upstream"): Promise<void> {
    if (this.tryTake()) return;
    const deficit = 1 - this.tokens;
    const waitMs = Math.ceil((deficit / this.refillPerSec) * 1000);
    if (waitMs > this.maxWaitMs) {
      throw new ProviderError("RATE_LIMITED", `${scope} 限频：需等待 ${waitMs}ms`, "ratelimit", 429);
    }
    await new Promise((r) => setTimeout(r, waitMs));
    this.refill();
    if (this.tokens < 1) {
      throw new ProviderError("RATE_LIMITED", `${scope} 限频`, "ratelimit", 429);
    }
    this.tokens -= 1;
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    if (elapsed <= 0) return;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerSec);
    this.lastRefill = now;
  }
}

/** 按 key 惰性创建桶（进程内共享） */
export class RateLimiter {
  private readonly buckets = new Map<string, TokenBucket>();

  constructor(private readonly factory: (key: string) => TokenBucket) {}

  bucket(key: string): TokenBucket {
    let b = this.buckets.get(key);
    if (!b) {
      b = this.factory(key);
      this.buckets.set(key, b);
    }
    return b;
  }

  reset(): void {
    this.buckets.clear();
  }
}
