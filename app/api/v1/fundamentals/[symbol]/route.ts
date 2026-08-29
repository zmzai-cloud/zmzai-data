// GET /api/v1/fundamentals/:symbol
// v1 只返回最小字段（市值 / 24h 成交额）。源未提供 → 501。需要 service-key 鉴权。

import type { NextRequest } from "next/server";

import { errorResponse, fail, guard, metaOf, parseSymbol } from "@/lib/api";
import { resolveFundamentals } from "@/lib/market-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest, ctx: { params: Promise<{ symbol: string }> }) {
  const denied = guard(req);
  if (denied) return denied;

  const p = parseSymbol((await ctx.params).symbol);
  if (!p.ok) return p.res;

  try {
    const r = await resolveFundamentals(metaOf(req, p.symbol, "fundamentals"), p.symbol);
    if (!r.value) {
      // TODO(v2): A股接 daily_basic（总市值/换手率）与财务三表；加密补市值源。
      // 深度基本面不在 v1 范围，明确返回 501 而不是伪造字段。
      return fail(501, "NOT_IMPLEMENTED", `${p.symbol} 所属市场的基本面数据 v1 未提供（TODO: 接 daily_basic / 市值源）`, {
        symbol: p.symbol,
      });
    }
    return Response.json(
      { provider: r.provider, cached: r.cached, fundamentals: r.value },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return errorResponse(err, p.symbol);
  }
}
