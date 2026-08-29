// 上游 HTTP 封装：统一超时、错误归类为 ProviderError。

import { getServerEnv } from "@/config/env";
import { ProviderError } from "./providers/interface";

export interface JsonRequest {
  url: string;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
}

/** 带超时地取 JSON；非 2xx / 解析失败 → ProviderError */
export async function fetchJson<T>(req: JsonRequest): Promise<T> {
  const env = getServerEnv();
  const timeoutMs = req.timeoutMs ?? env.HTTP_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(req.url, {
      method: req.method ?? "GET",
      headers: {
        accept: "application/json",
        ...(req.body !== undefined ? { "content-type": "application/json" } : {}),
        ...req.headers,
      },
      body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      if (res.status === 401 || res.status === 403) {
        throw new ProviderError("UNAUTHORIZED", `上游鉴权失败 (${res.status})`, "http", 401, res.status);
      }
      if (res.status === 429) {
        throw new ProviderError("RATE_LIMITED", `上游限频：${text.slice(0, 160)}`, "http", 429, res.status);
      }
      if (res.status === 404) {
        throw new ProviderError("NOT_FOUND", `标的不存在 (${res.status})`, "http", 404, res.status);
      }
      throw new ProviderError("UNAVAILABLE", `上游 ${res.status}: ${text.slice(0, 160)}`, "http", 502, res.status);
    }
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("abort")) {
      throw new ProviderError("UNAVAILABLE", `上游超时（${timeoutMs}ms）`, "http", 504);
    }
    throw new ProviderError("UNAVAILABLE", `上游不可达：${msg}`, "http", 503);
  } finally {
    clearTimeout(timer);
  }
}

/** yyyy-mm-dd（本地时区，A股/加密数据源都用日期字符串，不涉及时区换算） */
export function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** yyyymmdd（Tushare 日期格式） */
export function compactDate(d: Date): string {
  return isoDate(d).replace(/-/g, "");
}

export function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

/** 安全转数字：非有限数返回 null */
export function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}
