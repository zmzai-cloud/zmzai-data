// GET /api/v1/quotes/:symbol
// 最新报价（由最近两根日线推导）。需要 service-key 鉴权。

import type { NextRequest } from "next/server";

import { errorResponse, guard, metaOf, parseSymbol } from "@/lib/api";
import { resolveQuote } from "@/lib/market-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest, ctx: { params: Promise<{ symbol: string }> }) {
  const denied = guard(req);
  if (denied) return denied;

  const p = parseSymbol((await ctx.params).symbol);
  if (!p.ok) return p.res;

  try {
    const r = await resolveQuote(metaOf(req, p.symbol, "quotes"), p.symbol);
    return Response.json(
      { provider: r.provider, cached: r.cached, quote: r.value },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return errorResponse(err, p.symbol);
  }
}
