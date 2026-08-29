// GET /api/health → { ok, deps: { tushare?, binance? } }
//
// 公开端点（无需 service-key）：给 Caddy / 冒烟脚本 / 部署脚本探活用。
// 默认只报配置状态，不打扰上游；加 ?probe=1 才真正打一次上游。

import { NextResponse } from "next/server";

import { serviceKeyConfigured } from "@/lib/auth";
import { getServerEnv } from "@/config/env";
import { fetchJson } from "@/lib/http";
import { tushare } from "@/lib/market-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface DepStatus {
  market: string;
  configured: boolean;
  status: "ok" | "unconfigured" | "error" | "unknown";
  note?: string;
}

async function probeBinance(): Promise<DepStatus> {
  for (const base of [getServerEnv().BINANCE_API_BASE, ...getServerEnv().BINANCE_FALLBACK_BASES]) {
    try {
      await fetchJson<unknown>({ url: `${base.replace(/\/$/, "")}/api/v3/ping`, timeoutMs: 6_000 });
      return { market: "加密", configured: true, status: "ok", note: base };
    } catch {
      // 逐个域名试，全部失败才判定该依赖不可用
      continue;
    }
  }
  return { market: "加密", configured: true, status: "error", note: "所有 Binance 域名均不可达" };
}

async function probeTushare(): Promise<DepStatus> {
  if (!getServerEnv().TUSHARE_TOKEN) {
    return {
      market: "A股",
      configured: false,
      status: "unconfigured",
      note: "未配置 TUSHARE_TOKEN，A股接口将返回 503",
    };
  }
  try {
    // 最小代价探活：拉 000001.SZ 最近 5 天日线
    await tushare.getBars("000001", "1m", 5);
    return { market: "A股", configured: true, status: "ok" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { market: "A股", configured: true, status: "error", note: msg.slice(0, 200) };
  }
}

export async function GET(req: Request) {
  const probe = new URL(req.url).searchParams.get("probe") === "1";
  const deps: Record<string, DepStatus> = probe
    ? { tushare: await probeTushare(), binance: await probeBinance() }
    : {
        tushare: {
          market: "A股",
          configured: Boolean(getServerEnv().TUSHARE_TOKEN),
          status: getServerEnv().TUSHARE_TOKEN ? "unknown" : "unconfigured",
        },
        // 加密源无需 key，始终视为已配置；真实可达性用 ?probe=1 验证
        binance: { market: "加密", configured: true, status: "unknown" },
      };

  const failed = Object.values(deps).filter((d) => d.status === "error").length;
  return NextResponse.json(
    {
      ok: failed === 0,
      service: "zmzai-data",
      auth: serviceKeyConfigured() ? "configured" : "missing",
      probe,
      deps,
      now: new Date().toISOString(),
    },
    { status: failed === 0 ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
