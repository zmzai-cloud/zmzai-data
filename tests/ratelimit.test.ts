import { describe, expect, it } from "vitest";

import { ProviderError } from "@/lib/providers/interface";
import { RateLimiter, TokenBucket } from "@/lib/ratelimit";

describe("TokenBucket", () => {
  it("容量内的突发全部放行，超出即拒绝", () => {
    const b = new TokenBucket({ refillPerSec: 10, capacity: 3 });
    expect(b.tryTake()).toBe(true);
    expect(b.tryTake()).toBe(true);
    expect(b.tryTake()).toBe(true);
    expect(b.tryTake()).toBe(false);
  });

  it("令牌按时间补充后可再次取用", async () => {
    const b = new TokenBucket({ refillPerSec: 100, capacity: 1 });
    expect(b.tryTake()).toBe(true);
    expect(b.tryTake()).toBe(false);
    await new Promise((r) => setTimeout(r, 30));
    expect(b.tryTake()).toBe(true);
  });

  it("acquire 在等待时间可控时排队等待", async () => {
    const b = new TokenBucket({ refillPerSec: 100, capacity: 1, maxWaitMs: 2_000 });
    await b.acquire();
    await expect(b.acquire()).resolves.toBeUndefined();
  });

  it("等待时间超过 maxWaitMs 直接抛 RATE_LIMITED", async () => {
    const b = new TokenBucket({ refillPerSec: 0.01, capacity: 1, maxWaitMs: 10 });
    b.tryTake();
    await expect(b.acquire("tushare")).rejects.toMatchObject({ code: "RATE_LIMITED", status: 429 });
  });
});

describe("RateLimiter", () => {
  it("按 key 复用同一个桶", () => {
    const l = new RateLimiter(() => new TokenBucket({ refillPerSec: 5, capacity: 1 }));
    const a = l.bucket("tushare");
    expect(l.bucket("tushare")).toBe(a);
    expect(l.bucket("binance")).not.toBe(a);
  });

  it("ProviderError 携带来源与状态", () => {
    const e = new ProviderError("UNAVAILABLE", "boom", "tushare");
    expect(e.status).toBe(503);
    expect(e.provider).toBe("tushare");
    expect(new ProviderError("NOT_FOUND", "x", "binance").status).toBe(404);
  });
});
