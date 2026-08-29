// GET /api/v1/bars/:symbol?range=1y|6m|3m|1m&limit=
// 日线 K 线（升序）。需要 service-key 鉴权。

import type { NextRequest } from "next/server";

import { errorResponse, fail, guard, metaOf, parseLimit, parseRange, parseSymbol } from "@/lib/api";
import { resolveBars } from "@/lib/market-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest, ctx: { params: Promise<{ symbol: string }> }) {
  const denied = guard(req);
  if (denied) return denied;

  const p = parseSymbol((await ctx.params).symbol);
  if (!p.ok) return p.res;
  const range = parseRange(new URL(req.url).searchParams.get("range"));
  if (!range.ok) return range.res;
  const limit = parseLimit(new URL(req.url).searchParams.get("limit"));
  if (!limit.ok) return limit.res;

  try {
    const r = await resolveBars(metaOf(req, p.symbol, "bars"), p.symbol, range.range, limit.limit);
    if (r.value.length === 0) {
      return fail(404, "NO_DATA", `该标的在 ${range.range} 区间内没有日线数据`, { symbol: p.symbol });
    }
    return Response.json(
      {
        symbol: p.symbol,
        market: r.market,
        range: range.range,
        limit: limit.limit ?? null,
        provider: r.provider,
        cached: r.cached,
        count: r.value.length,
        bars: r.value,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return errorResponse(err, p.symbol);
  }
}
