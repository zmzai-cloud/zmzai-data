// 进程内 TTL 缓存。
//
// 语义：历史日线（最后一根 K 线不是今天）长缓存 6h；一旦窗口内包含当日数据
// （盘中会变）降级为 60s。缓存 key 由调用方拼接（symbol + range + limit）。
//
// TODO(v2): 换/叠加 Mongo 持久化存储层，见 lib/store.ts 的 BarStore 接口。
// 当前进程内缓存在多实例部署下会各存一份，可接受（上游还有源站限频保护）。

import { getServerEnv } from "@/config/env";
import { isoDate } from "./http";
import type { Bar } from "./providers/interface";

interface Entry {
  value: unknown;
  expiresAt: number;
}

export class TtlCache {
  private readonly map = new Map<string, Entry>();

  get size(): number {
    return this.map.size;
  }

  get<T>(key: string): T | null {
    const hit = this.map.get(key);
    if (!hit) return null;
    if (Date.now() >= hit.expiresAt) {
      this.map.delete(key);
      return null;
    }
    return hit.value as T;
  }

  set(key: string, value: unknown, ttlMs: number): void {
    this.map.set(key, { value, expiresAt: Date.now() + ttlMs });
    this.sweep();
  }

  delete(key: string): void {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  /** 惰性清理：仅在超过阈值时全量扫一遍过期项，避免每次写都 O(n) */
  private sweep(): void {
    if (this.map.size < 512) return;
    const now = Date.now();
    for (const [k, v] of this.map) if (now >= v.expiresAt) this.map.delete(k);
  }
}

export const cache = new TtlCache();

/**
 * 日线数据的 TTL：窗口含「当日」数据 → 短 TTL；否则长 TTL。
 * 判断依据：最后一根 bar 的 date >= 今天（含未来日期的兜底）。
 */
export function barsTtl(bars: Bar[], now = new Date()): number {
  const env = getServerEnv();
  const last = bars[bars.length - 1]?.date;
  const today = isoDate(now);
  if (last && last >= today) return env.CACHE_TODAY_TTL_MS;
  return env.CACHE_HISTORY_TTL_MS;
}

/** 报价（实时性要求更高）统一走当日短 TTL */
export function quoteTtl(): number {
  return getServerEnv().CACHE_TODAY_TTL_MS;
}
