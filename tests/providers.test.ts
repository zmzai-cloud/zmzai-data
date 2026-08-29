import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BinanceProvider } from "@/lib/providers/binance";
import { ProviderError } from "@/lib/providers/interface";
import { TushareProvider } from "@/lib/providers/tushare";
import { jsonResponse, setupEnv } from "./helpers";

const tushare = new TushareProvider();
const binance = new BinanceProvider();

beforeEach(() => {
  setupEnv({
    TUSHARE_TOKEN: "tk_test",
    TUSHARE_API_URL: "http://api.waditu.com",
    BINANCE_API_BASE: "https://api.binance.com",
    BINANCE_FALLBACK_BASES: "https://data-api.binance.vision",
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------- Tushare ----------

const TUSHARE_BODY = {
  code: 0,
  msg: null,
  data: {
    fields: ["trade_date", "open", "high", "low", "close", "vol", "amount"],
    // 注意：Tushare 按交易日倒序返回
    items: [
      ["20260828", 10.1, 10.8, 10, 10.5, 1234.5, 130000],
      ["20260827", 9.6, 10.2, 9.5, 10, 1000, 99000],
      ["20260826", 9.4, 9.8, 9.3, 9.6, 800, 76000],
    ],
  },
};

describe("TushareProvider", () => {
  it("解析日线：升序 + vol 手→股", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(TUSHARE_BODY));
    vi.stubGlobal("fetch", fetchMock);

    const bars = await tushare.getBars("600519", "1y");
    expect(bars.map((b) => b.date)).toEqual(["2026-08-26", "2026-08-27", "2026-08-28"]);
    expect(bars[2]).toEqual({ date: "2026-08-28", open: 10.1, high: 10.8, low: 10, close: 10.5, volume: 123450 });
    // 请求体带 api_name / token / ts_code
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    expect(body.api_name).toBe("daily");
    expect(body.token).toBe("tk_test");
    expect(body.params.ts_code).toBe("600519.SH");
  });

  it("limit 取最近 N 根", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(TUSHARE_BODY)));
    const bars = await tushare.getBars("000001", "1y", 2);
    expect(bars.map((b) => b.date)).toEqual(["2026-08-27", "2026-08-28"]);
  });

  it("报价由最近两根日线推导", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(TUSHARE_BODY)));
    const q = await tushare.getQuote("600519");
    expect(q).toMatchObject({ symbol: "600519", market: "A股", price: 10.5, prevClose: 10, currency: "CNY" });
    expect(q.changePct).toBeCloseTo(0.05, 6);
  });

  it("未配置 TUSHARE_TOKEN → 明确 503，不静默降级", async () => {
    setupEnv({ TUSHARE_TOKEN: undefined });
    await expect(tushare.getBars("600519", "1y")).rejects.toMatchObject({ code: "UNAVAILABLE", status: 503 });
    await expect(tushare.getQuote("600519")).rejects.toMatchObject({ status: 503 });
  });

  it("上游 token 报错归为鉴权类 401", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ code: 40201, msg: "抱歉，您尚未获取该接口的访问权限" })));
    await expect(tushare.getBars("600519", "1y")).rejects.toMatchObject({ code: "UNAUTHORIZED", status: 401 });
  });

  it("fundamentals v1 未实现 → null", async () => {
    await expect(tushare.getFundamentals?.("600519")).resolves.toBeNull();
  });

  it("supports 只认 6 位数字", () => {
    expect(tushare.supports("600519")).toBe(true);
    expect(tushare.supports("BTC")).toBe(false);
  });
});

// ---------- Binance ----------

function kline(openTimeMs: number, close: string) {
  return [openTimeMs, "1.0", "2.0", "0.5", close, "100", openTimeMs + 86_399_999, "0", 1, "0", "0", "0"];
}

describe("BinanceProvider", () => {
  it("解析日线：UTC 日期升序 + limit 截断", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse([
        kline(Date.UTC(2026, 7, 26), "100"),
        kline(Date.UTC(2026, 7, 27), "110"),
        kline(Date.UTC(2026, 7, 28), "120"),
      ]),
    );
    vi.stubGlobal("fetch", fetchMock);

    const bars = await binance.getBars("BTC", "1m");
    expect(bars.map((b) => b.date)).toEqual(["2026-08-26", "2026-08-27", "2026-08-28"]);
    expect(bars[1].close).toBe(110);
    expect(bars[1].volume).toBe(100);
    expect(fetchMock.mock.calls[0][0]).toContain("symbol=BTCUSDT");

    const limited = await binance.getBars("BTC", "1m", 2);
    expect(limited.map((b) => b.date)).toEqual(["2026-08-27", "2026-08-28"]);
  });

  it("主域名不可达时降级到备用域名", async () => {
    setupEnv({ BINANCE_API_BASE: "https://blocked.invalid", BINANCE_FALLBACK_BASES: "https://mirror.example" });
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("connect ECONNREFUSED"))
      .mockResolvedValueOnce(jsonResponse([kline(Date.UTC(2026, 7, 28), "120")]));
    vi.stubGlobal("fetch", fetchMock);

    const bars = await binance.getBars("BTC", "1m");
    expect(bars).toHaveLength(1);
    expect(fetchMock.mock.calls[1][0]).toContain("https://mirror.example");
  });

  it("非法交易对映射为 404", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ code: -1121, msg: "Invalid symbol." }, 400)));
    await expect(binance.getBars("NOTACOIN", "1m")).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });

  it("报价走 ticker/24hr，百分比换算为小数", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          lastPrice: "78038.00",
          prevClosePrice: "79487.71",
          priceChange: "-1449.71",
          priceChangePercent: "-1.824",
          quoteVolume: "964661124.05",
          closeTime: Date.UTC(2026, 7, 28),
        }),
      ),
    );
    const q = await binance.getQuote("BTC");
    expect(q).toMatchObject({ symbol: "BTC", market: "加密", price: 78038, prevClose: 79487.71, currency: "USDT" });
    expect(q.changePct).toBeCloseTo(-0.01824, 6);
    expect(q.date).toBe("2026-08-28");
  });

  it("fundamentals 返回最小字段（市值留空 TODO）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ quoteVolume: "964661124.05", closeTime: Date.UTC(2026, 7, 28) })),
    );
    const f = await binance.getFundamentals("BTC");
    expect(f).toMatchObject({ symbol: "BTC", marketCap: null, volume24h: 964661124.05, currency: "USDT" });
  });

  it("所有域名都失败 → UNAVAILABLE", async () => {
    setupEnv({ BINANCE_API_BASE: "https://a.invalid", BINANCE_FALLBACK_BASES: "https://b.invalid" });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    await expect(binance.getBars("BTC", "1m")).rejects.toBeInstanceOf(ProviderError);
    await expect(binance.getBars("BTC", "1m")).rejects.toMatchObject({ status: 503 });
  });
});
