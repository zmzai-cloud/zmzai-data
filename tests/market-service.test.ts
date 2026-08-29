import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { barsCacheKey, providersFor, resetRateLimiter, resolveBars, resolveQuote } from "@/lib/market-service";
import { cache } from "@/lib/cache";
import { jsonResponse, setupEnv } from "./helpers";

beforeEach(() => {
  cache.clear();
  resetRateLimiter();
  setupEnv({
    DATA_SERVICE_KEY_CURRENT: undefined,
    TUSHARE_TOKEN: "tk_test",
    BINANCE_API_BASE: "https://api.binance.com",
    BINANCE_FALLBACK_BASES: "https://data-api.binance.vision",
    CACHE_HISTORY_TTL_MS: "600000",
    CACHE_TODAY_TTL_MS: "1000",
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  cache.clear();
});

function kline(openTimeMs: number, close: string) {
  return [openTimeMs, "1.0", "2.0", "0.5", close, "100", openTimeMs + 86_399_999, "0", 1, "0", "0", "0"];
}

const META = { endpoint: "bars" as const, symbol: "BTC", caller: "test" };

describe("providersFor", () => {
  it("A股走 tushare，加密走 binance", () => {
    expect(providersFor("600519").map((p) => p.name)).toEqual(["tushare"]);
    expect(providersFor("BTC").map((p) => p.name)).toEqual(["binance"]);
  });
});

describe("resolveBars", () => {
  it("首次取数走上游，第二次命中缓存", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse([kline(Date.UTC(2020, 0, 2), "110"), kline(Date.UTC(2020, 0, 3), "120")]));
    vi.stubGlobal("fetch", fetchMock);

    const first = await resolveBars(META, "BTC", "1m");
    expect(first.cached).toBe(false);
    expect(first.provider).toBe("binance");
    expect(first.value).toHaveLength(2);

    const second = await resolveBars(META, "BTC", "1m");
    expect(second.cached).toBe(true);
    expect(second.provider).toBe("cache");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("缓存 key 区分 symbol / range / limit", () => {
    expect(barsCacheKey("BTC", "1y")).not.toBe(barsCacheKey("ETH", "1y"));
    expect(barsCacheKey("BTC", "1y")).not.toBe(barsCacheKey("BTC", "1m"));
    expect(barsCacheKey("BTC", "1y", 30)).not.toBe(barsCacheKey("BTC", "1y"));
  });

  it("A股缺 token 时 503 且提示明确", async () => {
    setupEnv({ TUSHARE_TOKEN: undefined });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(resolveBars({ ...META, symbol: "600519" }, "600519", "1y")).rejects.toMatchObject({
      code: "UNAVAILABLE",
      status: 503,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("resolveQuote", () => {
  it("缓存命中不再打上游", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ lastPrice: "100", prevClosePrice: "90", priceChange: "10", priceChangePercent: "11.111" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const a = await resolveQuote({ ...META, endpoint: "quotes" }, "BTC");
    expect(a.cached).toBe(false);
    expect(a.value.price).toBe(100);
    const b = await resolveQuote({ ...META, endpoint: "quotes" }, "BTC");
    expect(b.cached).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
