// 加密日线数据源：Binance 公开 REST（USDT 现货，无需 API key）。
//
//   GET {base}/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=N
//     → [[openTime, open, high, low, close, volume, closeTime, ...], ...]（升序）
//   GET {base}/api/v3/ticker/24hr?symbol=BTCUSDT
//     → { lastPrice, prevClosePrice, priceChange, priceChangePercent, quoteVolume, closeTime, ... }
//
// 域名可达性：api.binance.com 在部分区域被墙，因此主域名失败时按
// BINANCE_FALLBACK_BASES 顺序降级（默认 data-api.binance.vision，官方只读镜像）。

import { getServerEnv } from "@/config/env";
import { fetchJson, num } from "../http";
import { currencyOf, toBinanceSymbol } from "../symbol";
import {
  ProviderError,
  RANGE_DAYS,
  type Bar,
  type BarRange,
  type Fundamental,
  type Market,
  type MarketDataProvider,
  type Quote,
} from "./interface";

type Kline = [number, string, string, string, string, string, number, ...unknown[]];

interface Ticker24h {
  lastPrice?: string;
  prevClosePrice?: string;
  openPrice?: string;
  priceChange?: string;
  priceChangePercent?: string;
  quoteVolume?: string;
  closeTime?: number;
  code?: number;
  msg?: string;
}

/** Binance 交易对不合法：{"code":-1121,"msg":"Invalid symbol."} */
const INVALID_SYMBOL_CODE = -1121;

export class BinanceProvider implements MarketDataProvider {
  readonly name = "binance";
  readonly market: Market = "加密";

  supports(symbol: string): boolean {
    return !/^\d{6}$/.test(symbol);
  }

  /** 主域名 + 备用域名（顺序即 failover 顺序） */
  private bases(): string[] {
    const env = getServerEnv();
    return [env.BINANCE_API_BASE, ...env.BINANCE_FALLBACK_BASES].map((b) => b.replace(/\/$/, ""));
  }

  /** 依次尝试各域名，全部失败则抛最后一个错误 */
  private async withFailover<T>(fn: (base: string) => Promise<T>): Promise<T> {
    const bases = this.bases();
    let lastErr: unknown;
    for (const base of bases) {
      try {
        return await fn(base);
      } catch (err) {
        lastErr = err;
        // 标的本身不存在（Binance 明确 -1121）无需再试其他域名
        if (err instanceof ProviderError && err.code === "NOT_FOUND") throw err;
      }
    }
    throw lastErr instanceof Error
      ? lastErr
      : new ProviderError("UNAVAILABLE", "所有 Binance 域名均不可用", this.name, 503);
  }

  /** 上游 400 且 body 含 -1121 → 标的不存在 */
  private asNotFound(err: unknown, symbol: string): never {
    if (err instanceof ProviderError && err.upstreamStatus === 400 && err.message.includes(String(INVALID_SYMBOL_CODE))) {
      throw new ProviderError("NOT_FOUND", `Binance 无此交易对：${symbol}USDT`, this.name, 404);
    }
    throw err;
  }

  async getBars(symbol: string, range: BarRange, limit?: number): Promise<Bar[]> {
    const pair = toBinanceSymbol(symbol);
    const want = RANGE_DAYS[range];
    const bars = await this.withFailover(async (base): Promise<Bar[]> => {
      try {
        const klines = await fetchJson<Kline[]>({
          url: `${base}/api/v3/klines?symbol=${pair}&interval=1d&limit=${want}`,
        });
        if (!Array.isArray(klines)) {
          throw new ProviderError("BAD_UPSTREAM", "Binance klines 返回格式异常", this.name, 502);
        }
        return klines.map((k) => ({
          date: utcDate(k[0]),
          open: num(k[1]) ?? 0,
          high: num(k[2]) ?? 0,
          low: num(k[3]) ?? 0,
          close: num(k[4]) ?? 0,
          volume: num(k[5]) ?? 0,
        }));
      } catch (err) {
        this.asNotFound(err, symbol);
      }
    });
    return typeof limit === "number" && limit > 0 ? bars.slice(-limit) : bars;
  }

  async getQuote(symbol: string): Promise<Quote> {
    const pair = toBinanceSymbol(symbol);
    try {
      return await this.withFailover(async (base) => {
        const t = await fetchJson<Ticker24h>({ url: `${base}/api/v3/ticker/24hr?symbol=${pair}` });
        const price = num(t.lastPrice);
        if (price === null) {
          throw new ProviderError("BAD_UPSTREAM", "Binance ticker 缺少 lastPrice", this.name, 502);
        }
        const prev = num(t.prevClosePrice) ?? num(t.openPrice) ?? null;
        const pctFromTicker = num(t.priceChangePercent);
        return {
          symbol,
          market: this.market,
          price,
          prevClose: prev,
          change: num(t.priceChange) ?? (prev === null ? null : round(price - prev)),
          // ticker 的 priceChangePercent 是百分数（"-1.824"）→ 转为小数
          changePct: pctFromTicker === null ? null : round(pctFromTicker / 100),
          date: utcDate(t.closeTime ?? Date.now()),
          currency: currencyOf(this.market),
          source: this.name,
        };
      });
    } catch (err) {
      // ticker 端点偶发不可用时，退化为用最近两根日线推导报价
      if (err instanceof ProviderError && err.code === "NOT_FOUND") throw err;
      const bars = await this.getBars(symbol, "1m", 2);
      const last = bars[bars.length - 1];
      if (!last) throw err;
      const prev = bars.length > 1 ? bars[bars.length - 2].close : null;
      return {
        symbol,
        market: this.market,
        price: last.close,
        prevClose: prev,
        change: prev === null ? null : round(last.close - prev),
        changePct: prev === null || prev === 0 ? null : round((last.close - prev) / prev),
        date: last.date,
        currency: currencyOf(this.market),
        source: `${this.name}:klines`,
      };
    }
  }

  async getFundamentals(symbol: string): Promise<Fundamental | null> {
    const pair = toBinanceSymbol(symbol);
    return await this.withFailover(async (base): Promise<Fundamental> => {
      try {
        const t = await fetchJson<Ticker24h>({ url: `${base}/api/v3/ticker/24hr?symbol=${pair}` });
        return {
          symbol,
          market: this.market,
          // TODO(v2): 市值需要 CoinGecko / CoinMarketCap 等市值源，Binance 现货接口不提供
          marketCap: null,
          volume24h: num(t.quoteVolume),
          currency: currencyOf(this.market),
          source: this.name,
          asOf: utcDate(t.closeTime ?? Date.now()),
        };
      } catch (err) {
        this.asNotFound(err, symbol);
      }
    });
  }
}

function utcDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function round(n: number, digits = 6): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}
