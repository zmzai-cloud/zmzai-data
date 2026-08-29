// 行情路由层：符号归一化 → 选源（含 failover）→ 限频 → 缓存 → 用量日志。
//
// 这是 API 路由与数据源之间的唯一入口：路由层只做参数解析与错误映射，
// 业务规则（缓存时长、限频、降级顺序、日志）全部收敛在这里。

import { getServerEnv } from "@/config/env";
import { barsTtl, cache, quoteTtl } from "./cache";
import { ProviderError, type Bar, type BarRange, type Fundamental, type Market, type MarketDataProvider, type Quote } from "./providers/interface";
import { BinanceProvider } from "./providers/binance";
import { TushareProvider } from "./providers/tushare";
import { RateLimiter, TokenBucket } from "./ratelimit";
import { marketOf } from "./symbol";
import { logUsage, type UsageRecord } from "./usage";

export const tushare = new TushareProvider();
export const binance = new BinanceProvider();

/**
 * 按配置顺序给出候选数据源。v1 每个市场只有一个源（A股 tushare / 加密 binance），
 * 但降级链路已经铺好：新增源只要实现 MarketDataProvider 并压进数组即生效。
 * （binance 内部还有多域名 failover，见 providers/binance.ts）
 */
export function providersFor(symbol: string): MarketDataProvider[] {
  return marketOf(symbol) === "A股" ? [tushare] : [binance];
}

const limiter = new RateLimiter((key) => {
  const env = getServerEnv();
  if (key === "tushare") return new TokenBucket({ refillPerSec: env.RATE_LIMIT_TUSHARE_RPS });
  return new TokenBucket({ refillPerSec: env.RATE_LIMIT_BINANCE_RPS });
});

/** 测试用：清空限频桶 */
export function resetRateLimiter(): void {
  limiter.reset();
}

export interface Resolved<T> {
  value: T;
  provider: string;
  cached: boolean;
  market: Market;
}

export interface EndpointMeta {
  endpoint: UsageRecord["endpoint"];
  symbol: string;
  caller: string;
}

/** 缓存条目统一包一层：这样 null（如「该市场无基本面数据」）也能被缓存 */
interface CacheBox<T> {
  value: T;
}

/** 统一执行：限频 → 缓存 → 源（failover）→ 写缓存 → 记用量 */
async function run<T>(
  meta: EndpointMeta,
  cacheKey: string,
  ttlOf: (value: T) => number,
  fetcher: (p: MarketDataProvider) => Promise<T>,
): Promise<Resolved<T>> {
  const started = Date.now();
  const market = marketOf(meta.symbol);
  const base: Omit<UsageRecord, "provider" | "cached" | "ms" | "rows" | "ok" | "error"> = {
    caller: meta.caller,
    symbol: meta.symbol,
    market,
    endpoint: meta.endpoint,
  };

  const hit = cache.get<CacheBox<T>>(cacheKey);
  if (hit) {
    logUsage({
      ...base,
      provider: "cache",
      cached: true,
      ms: Date.now() - started,
      rows: rowsOf(hit.value),
      ok: true,
    });
    return { value: hit.value, provider: "cache", cached: true, market };
  }

  const providers = providersFor(meta.symbol);
  let lastErr: unknown;
  for (const p of providers) {
    try {
      await limiter.bucket(p.name).acquire(p.name);
      const value = await fetcher(p);
      cache.set(cacheKey, { value } satisfies CacheBox<T>, ttlOf(value));
      logUsage({ ...base, provider: p.name, cached: false, ms: Date.now() - started, rows: rowsOf(value), ok: true });
      return { value, provider: p.name, cached: false, market };
    } catch (err) {
      lastErr = err;
      // 标的不存在 / 鉴权失败不再尝试下一个源（换源也不会变）
      if (err instanceof ProviderError && (err.code === "NOT_FOUND" || err.code === "UNAUTHORIZED")) break;
    }
  }

  const err = lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  logUsage({
    ...base,
    provider: providers.map((p) => p.name).join(">") || "-",
    cached: false,
    ms: Date.now() - started,
    rows: 0,
    ok: false,
    error: err.message,
  });
  throw err;
}

function rowsOf(v: unknown): number {
  if (Array.isArray(v)) return v.length;
  return v === null || v === undefined ? 0 : 1;
}

export function barsCacheKey(symbol: string, range: BarRange, limit?: number): string {
  return `bars:${symbol}:${range}:${limit ?? "all"}`;
}

export function quoteCacheKey(symbol: string): string {
  return `quote:${symbol}`;
}

export function fundamentalsCacheKey(symbol: string): string {
  return `fundamentals:${symbol}`;
}

export function resolveBars(
  meta: EndpointMeta,
  symbol: string,
  range: BarRange,
  limit?: number,
): Promise<Resolved<Bar[]>> {
  return run<Bar[]>(
    { ...meta, endpoint: "bars" },
    barsCacheKey(symbol, range, limit),
    (bars) => barsTtl(bars),
    (p) => p.getBars(symbol, range, limit),
  );
}

export function resolveQuote(meta: EndpointMeta, symbol: string): Promise<Resolved<Quote>> {
  return run<Quote>(
    { ...meta, endpoint: "quotes" },
    quoteCacheKey(symbol),
    () => quoteTtl(),
    (p) => p.getQuote(symbol),
  );
}

export function resolveFundamentals(
  meta: EndpointMeta,
  symbol: string,
): Promise<Resolved<Fundamental | null>> {
  return run<Fundamental | null>(
    { ...meta, endpoint: "fundamentals" },
    fundamentalsCacheKey(symbol),
    () => quoteTtl(),
    async (p) => (p.getFundamentals ? p.getFundamentals(symbol) : null),
  );
}
