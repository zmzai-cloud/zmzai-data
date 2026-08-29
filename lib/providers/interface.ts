// 行情服务数据契约。
//
// Bar 字段刻意与 zmzai-arena 引擎的 Bar（src/sim/market.ts）对齐：
//   arena: { t, date?, open?, close, high, low, volume? }
//   本服务序列化时带上 date（ISO yyyy-mm-dd），arena 侧 loadRealMarket 再补索引 t。
// 单位约定：价格 = 报价货币（A股 元 / 加密 USDT），volume = 标的原生数量
//   A股 = 股（Tushare 原始「手」已 ×100 归一），加密 = 币（如 BTC 的数量）。

export type Market = "A股" | "加密";

/** 日线 K 线（升序：早 → 晚） */
export interface Bar {
  /** 交易日 / 自然日，yyyy-mm-dd（加密为 UTC 自然日） */
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Quote {
  /** 归一化的规范代码（A股 6 位数字 / 加密 base，如 BTC） */
  symbol: string;
  market: Market;
  /** 最近一根日线的收盘价 */
  price: number;
  /** 上一根日线收盘价（无数据时为 null） */
  prevClose: number | null;
  change: number | null;
  /** 涨跌幅（小数，0.0123 = +1.23%） */
  changePct: number | null;
  /** price 对应的日期 */
  date: string;
  currency: string;
  source: string;
}

/** v1 最小基本面字段；拿不到的字段为 null（深度财务三表不在 v1 范围） */
export interface Fundamental {
  symbol: string;
  market: Market;
  /** 总市值（报价货币）。v1 加密源不提供，恒为 null */
  marketCap: number | null;
  /** 最近 24h 成交额（报价货币） */
  volume24h: number | null;
  currency: string;
  source: string;
  asOf: string;
}

export type BarRange = "1m" | "3m" | "6m" | "1y";

export const BAR_RANGES: BarRange[] = ["1m", "3m", "6m", "1y"];

/** range → 往前推的自然日天数（多取一些，保证交易日后仍有足够根数） */
export const RANGE_DAYS: Record<BarRange, number> = {
  "1m": 31,
  "3m": 93,
  "6m": 186,
  "1y": 372,
};

export function isBarRange(v: unknown): v is BarRange {
  return typeof v === "string" && (BAR_RANGES as string[]).includes(v);
}

/**
 * 数据源错误。code 决定 HTTP 状态：
 *   UNAVAILABLE   → 503（源不可用 / 未配置 / 上游超时，调用方可重试）
 *   NOT_FOUND     → 404（标的在该源不存在）
 *   UNAUTHORIZED  → 401/403（源返回鉴权失败）
 *   BAD_UPSTREAM  → 502（源返回无法解析的数据）
 */
export class ProviderError extends Error {
  readonly code: "UNAVAILABLE" | "NOT_FOUND" | "UNAUTHORIZED" | "BAD_UPSTREAM" | "RATE_LIMITED";
  readonly status: number;
  readonly provider: string;
  /** 上游原始 HTTP 状态（用于区分「源站说没这个标的」与「源站挂了」） */
  readonly upstreamStatus?: number;

  constructor(
    code: ProviderError["code"],
    message: string,
    provider: string,
    status?: number,
    upstreamStatus?: number,
  ) {
    super(message);
    this.name = "ProviderError";
    this.code = code;
    this.provider = provider;
    this.status =
      status ??
      (code === "NOT_FOUND"
        ? 404
        : code === "UNAUTHORIZED"
          ? 401
          : code === "BAD_UPSTREAM"
            ? 502
            : code === "RATE_LIMITED"
              ? 429
              : 503);
    this.upstreamStatus = upstreamStatus;
  }
}

export interface MarketDataProvider {
  readonly name: string;
  readonly market: Market;

  /** 该源是否支持这个规范代码（路由与 failover 用） */
  supports(symbol: string): boolean;

  getQuote(symbol: string): Promise<Quote>;
  getBars(symbol: string, range: BarRange, limit?: number): Promise<Bar[]>;
  getFundamentals?(symbol: string): Promise<Fundamental | null>;
}
