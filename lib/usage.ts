// 取数用量日志：每一次「真正打到上游」或「命中缓存」的取数都留一条结构化日志，
// 供后续计费 / 配额 / 排障使用。
//
// TODO(@zmzai/contracts): 等事件契约包落地后，把 logUsage 换成
//   emit(UsageReported{ service:"zmzai-data", symbol, market, provider, endpoint, cached, ms })
// 由统一计费/可观测管线消费；契约未定前不自建事件格式，只保留下面的最小字段。

export interface UsageRecord {
  /** 调用来源服务（如 arena）；未知为 "-" */
  caller: string;
  symbol: string;
  market: string;
  provider: string;
  endpoint: "quotes" | "bars" | "fundamentals";
  cached: boolean;
  /** 上游/缓存耗时（ms） */
  ms: number;
  /** 返回的 K 线根数（quotes/fundamentals 为 0/1） */
  rows: number;
  ok: boolean;
  error?: string;
}

export function logUsage(r: UsageRecord): void {
  const line = JSON.stringify({ type: "usage", ts: new Date().toISOString(), ...r });
  if (r.ok) console.log(line);
  else console.warn(line);
}

/** 从请求头读调用方标识（内部服务自报，仅用于日志归因，不参与鉴权） */
export function callerOf(req: Request): string {
  return req.headers.get("x-zmzai-caller")?.trim() || "-";
}
