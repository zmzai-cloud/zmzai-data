// API 路由共享工具：鉴权拦截、参数解析、统一响应信封与错误映射。

import { NextResponse } from "next/server";

import { authorizeRequest, type AuthResult } from "./auth";
import type { EndpointMeta } from "./market-service";
import { ProviderError, isBarRange, type BarRange } from "./providers/interface";
import { SymbolError, normalizeSymbol } from "./symbol";

export type { EndpointMeta };

/** 统一失败响应：{ code, error, ... } */
export function fail(status: number, code: string, error: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ code, error, ...extra }, { status, headers: { "Cache-Control": "no-store" } });
}

/** 鉴权拦截：不通过直接返回响应，通过返回 null */
export function guard(req: Request): (NextResponse & {}) | null {
  const res: AuthResult = authorizeRequest(req);
  if (res.ok) return null;
  return fail(res.status, res.code, res.error) as NextResponse;
}

/** 用量日志元信息（endpoint 会被 market-service 按接口覆盖，这里给出默认值即可） */
export function metaOf(req: Request, symbol: string, endpoint: EndpointMeta["endpoint"]): EndpointMeta {
  return { caller: req.headers.get("x-zmzai-caller")?.trim() || "-", symbol, endpoint };
}

export type ParsedSymbol = { ok: true; symbol: string } | { ok: false; res: NextResponse };

export function parseSymbol(raw: string): ParsedSymbol {
  try {
    return { ok: true, symbol: normalizeSymbol(decodeURIComponent(raw)) };
  } catch (err) {
    if (err instanceof SymbolError) return { ok: false, res: fail(400, "INVALID_SYMBOL", err.message) };
    throw err;
  }
}

export type ParsedRange = { ok: true; range: BarRange } | { ok: false; res: NextResponse };

export function parseRange(raw: string | null): ParsedRange {
  const range = raw ?? "1y";
  if (!isBarRange(range)) {
    return { ok: false, res: fail(400, "INVALID_RANGE", `range 只支持 1m|3m|6m|1y，收到 ${range}`) };
  }
  return { ok: true, range };
}

export type ParsedLimit = { ok: true; limit: number | undefined } | { ok: false; res: NextResponse };

export function parseLimit(raw: string | null): ParsedLimit {
  if (raw === null || raw.trim() === "") return { ok: true, limit: undefined };
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0 || n > 1000) {
    return { ok: false, res: fail(400, "INVALID_LIMIT", "limit 必须是 1-1000 的整数") };
  }
  return { ok: true, limit: n };
}

/** ProviderError / 未知异常 → HTTP 响应 */
export function errorResponse(err: unknown, symbol?: string): NextResponse {
  const extra = symbol ? { symbol } : {};
  if (err instanceof ProviderError) {
    return fail(err.status, err.code, err.message, { ...extra, provider: err.provider, source: err.provider });
  }
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[zmzai-data] 未预期的错误：${msg}`);
  return fail(500, "INTERNAL", "服务内部错误", extra);
}
