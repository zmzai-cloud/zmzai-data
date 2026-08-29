import { afterEach, describe, expect, it } from "vitest";

import { TtlCache, barsTtl, cache, quoteTtl } from "@/lib/cache";
import type { Bar } from "@/lib/providers/interface";
import { setupEnv } from "./helpers";

afterEach(() => {
  cache.clear();
  setupEnv({ CACHE_HISTORY_TTL_MS: undefined, CACHE_TODAY_TTL_MS: undefined });
});

function bar(date: string, close = 10): Bar {
  return { date, open: close, high: close, low: close, close, volume: 1 };
}

describe("TtlCache", () => {
  it("命中未过期的键", () => {
    const c = new TtlCache();
    c.set("a", 1, 10_000);
    expect(c.get("a")).toBe(1);
  });

  it("过期后返回 null 并清理", () => {
    const c = new TtlCache();
    c.set("a", 1, -1);
    expect(c.get("a")).toBeNull();
    expect(c.size).toBe(0);
  });
});

describe("barsTtl", () => {
  it("最后一根是历史日期 → 长缓存", () => {
    setupEnv({ CACHE_HISTORY_TTL_MS: "600000", CACHE_TODAY_TTL_MS: "1000" });
    const today = new Date();
    const y = new Date(today);
    y.setDate(y.getDate() - 1);
    const s = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, "0")}-${String(y.getDate()).padStart(2, "0")}`;
    expect(barsTtl([bar(s)], today)).toBe(600000);
  });

  it("最后一根是今天 → 短缓存", () => {
    setupEnv({ CACHE_HISTORY_TTL_MS: "600000", CACHE_TODAY_TTL_MS: "1000" });
    const today = new Date();
    const s = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    expect(barsTtl([bar("2020-01-01"), bar(s)], today)).toBe(1000);
  });

  it("空序列按历史缓存处理", () => {
    setupEnv({ CACHE_HISTORY_TTL_MS: "600000", CACHE_TODAY_TTL_MS: "1000" });
    expect(barsTtl([])).toBe(600000);
  });

  it("quote 一律短缓存", () => {
    setupEnv({ CACHE_TODAY_TTL_MS: "1234" });
    expect(quoteTtl()).toBe(1234);
  });
});
