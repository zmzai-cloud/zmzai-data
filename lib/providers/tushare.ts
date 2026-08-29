// A股日线数据源：Tushare Pro。
//
// 接口：POST {TUSHARE_API_URL}  body { api_name, token, params, fields }
//   api_name = "daily"  → 日线行情（未复权；v1 统一用不复权收盘价，
//                         回测窗口短、分红除权影响有限；TODO(v2) 切 pro_bar 前复权）
//   fields   = trade_date,open,high,low,close,vol,amount
// 返回 { code, msg, data: { fields: string[], items: unknown[][] } }，items 按交易日倒序。
//
// TUSHARE_TOKEN 未配置时不静默降级——直接抛 UNAVAILABLE(503) 并说明缺哪个变量。

import { getServerEnv } from "@/config/env";
import { compactDate, daysAgo, fetchJson, num } from "../http";
import { currencyOf, toTsCode } from "../symbol";
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

interface TushareResponse {
  code?: number;
  msg?: string | null;
  data?: { fields?: string[]; items?: unknown[][] | null } | null;
}

export class TushareProvider implements MarketDataProvider {
  readonly name = "tushare";
  readonly market: Market = "A股";

  supports(symbol: string): boolean {
    return /^\d{6}$/.test(symbol);
  }

  private token(): string {
    const token = getServerEnv().TUSHARE_TOKEN;
    if (!token) {
      throw new ProviderError(
        "UNAVAILABLE",
        "A股数据源未配置：请在 zmzai-data 的环境变量中设置 TUSHARE_TOKEN（Tushare Pro token）",
        this.name,
        503,
      );
    }
    return token;
  }

  async getBars(symbol: string, range: BarRange, limit?: number): Promise<Bar[]> {
    const tsCode = toTsCode(symbol);
    const env = getServerEnv();
    const end = new Date();
    const start = daysAgo(RANGE_DAYS[range]);

    const res = await fetchJson<TushareResponse>({
      url: env.TUSHARE_API_URL,
      method: "POST",
      body: {
        api_name: "daily",
        token: this.token(),
        params: { ts_code: tsCode, start_date: compactDate(start), end_date: compactDate(end) },
        fields: "trade_date,open,high,low,close,vol,amount",
      },
    });

    if (res.code && res.code !== 0) {
      const msg = res.msg ?? `tushare code ${res.code}`;
      // 40201/40203 之类都是 token 相关问题，明确归到鉴权类
      const authLike = /token|权限|积分|用户/i.test(msg);
      throw new ProviderError(
        authLike ? "UNAUTHORIZED" : "UNAVAILABLE",
        `Tushare 返回错误 ${res.code}: ${msg}`,
        this.name,
        authLike ? 401 : 503,
      );
    }

    const fields = res.data?.fields ?? [];
    const items = res.data?.items ?? [];
    const idx = (name: string) => fields.indexOf(name);
    const iDate = idx("trade_date");
    const iOpen = idx("open");
    const iHigh = idx("high");
    const iLow = idx("low");
    const iClose = idx("close");
    const iVol = idx("vol");
    if (iDate < 0 || iClose < 0) {
      throw new ProviderError("BAD_UPSTREAM", "Tushare 返回缺少必要字段", this.name, 502);
    }

    const bars: Bar[] = [];
    for (const row of items) {
      const date = typeof row[iDate] === "string" ? (row[iDate] as string) : String(row[iDate] ?? "");
      const iso = date.length === 8 ? `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}` : date;
      const open = num(row[iOpen]);
      const high = num(row[iHigh]);
      const low = num(row[iLow]);
      const close = num(row[iClose]);
      if (!iso || close === null) continue;
      // Tushare vol 单位是「手」，归一化为「股」，与加密的「币」一样都是标的原生数量
      const volShares = iVol >= 0 ? (num(row[iVol]) ?? 0) * 100 : 0;
      bars.push({
        date: iso,
        open: open ?? close,
        high: high ?? close,
        low: low ?? close,
        close,
        volume: volShares,
      });
    }

    // Tushare 按交易日倒序返回 → 翻转为升序（早 → 晚）
    bars.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    return typeof limit === "number" && limit > 0 ? bars.slice(-limit) : bars;
  }

  async getQuote(symbol: string): Promise<Quote> {
    // 取最近两根日线：最后一根为最新价，前一根为昨收（涨停/新股无前一根时 prevClose 为 null）
    const bars = await this.getBars(symbol, "1m", 2);
    const last = bars[bars.length - 1];
    if (!last) {
      throw new ProviderError("NOT_FOUND", `A股 ${symbol} 暂无日线数据`, this.name, 404);
    }
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
      source: this.name,
    };
  }

  // v1 不实现：symbol 仅为对齐 MarketDataProvider 接口（TODO(v2): daily_basic + 财务三表）
  async getFundamentals(_symbol?: string): Promise<Fundamental | null> {
    return null;
  }
}

function round(n: number, digits = 6): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}
