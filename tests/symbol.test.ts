import { describe, expect, it } from "vitest";

import { currencyOf, marketOf, normalizeSymbol, SymbolError, toBinanceSymbol, toTsCode } from "@/lib/symbol";

describe("normalizeSymbol", () => {
  it("A股：裸代码 / 带后缀 / 带前缀都收敛为 6 位数字", () => {
    expect(normalizeSymbol("600519")).toBe("600519");
    expect(normalizeSymbol("600519.SH")).toBe("600519");
    expect(normalizeSymbol("sh600519")).toBe("600519");
    expect(normalizeSymbol(" 000001 ")).toBe("000001");
  });

  it("加密：BTC / BTCUSDT / eth 都收敛为 base", () => {
    expect(normalizeSymbol("BTC")).toBe("BTC");
    expect(normalizeSymbol("BTCUSDT")).toBe("BTC");
    expect(normalizeSymbol("eth")).toBe("ETH");
  });

  it("非法输入抛 SymbolError", () => {
    expect(() => normalizeSymbol("")).toThrow(SymbolError);
    expect(() => normalizeSymbol("!!!")).toThrow(SymbolError);
    expect(() => normalizeSymbol("60051")).toThrow(SymbolError);
  });

  it("市场判定与货币", () => {
    expect(marketOf("600519")).toBe("A股");
    expect(marketOf("BTC")).toBe("加密");
    expect(currencyOf("A股")).toBe("CNY");
    expect(currencyOf("加密")).toBe("USDT");
  });
});

describe("交易所代码映射", () => {
  it("A股 → Tushare ts_code", () => {
    expect(toTsCode("600519")).toBe("600519.SH");
    expect(toTsCode("688981")).toBe("688981.SH");
    expect(toTsCode("000001")).toBe("000001.SZ");
    expect(toTsCode("300750")).toBe("300750.SZ");
    expect(toTsCode("510300")).toBe("510300.SH");
    expect(toTsCode("159915")).toBe("159915.SZ");
  });

  it("加密 → Binance 交易对", () => {
    expect(toBinanceSymbol("BTC")).toBe("BTCUSDT");
    expect(toBinanceSymbol("ETH")).toBe("ETHUSDT");
  });

  it("跨市场调用抛错", () => {
    expect(() => toTsCode("BTC")).toThrow(SymbolError);
    expect(() => toBinanceSymbol("600519")).toThrow(SymbolError);
  });
});
