const ENDPOINTS: { method: string; path: string; desc: string }[] = [
  { method: "GET", path: "/api/health", desc: "健康检查（公开；?probe=1 会真正探测上游）" },
  { method: "GET", path: "/api/v1/quotes/:symbol", desc: "最新报价（最近两根日线推导）" },
  { method: "GET", path: "/api/v1/bars/:symbol?range=1y&limit=", desc: "日线 K 线（升序）" },
  { method: "GET", path: "/api/v1/fundamentals/:symbol", desc: "最小基本面（市值 / 24h 成交额）" },
];

export default function Home() {
  return (
    <main className="mx-auto w-[min(100%-2.5rem,52rem)] py-16">
      <p className="num text-[11px] tracking-[0.18em] text-ink-3 uppercase">zmzai.cloud · data</p>
      <h1 className="mt-3 text-3xl font-semibold text-ink">统一行情服务</h1>
      <p className="mt-3 text-[15px] text-ink-2">
        A股（Tushare）与加密 USDT 现货（Binance）的日线 / 报价 API。Provider 抽象 + 进程内 TTL 缓存 +
        token bucket 限频 + 多源 failover，服务间用 service-key 鉴权。
      </p>

      <section className="mt-10">
        <h2 className="text-sm font-semibold text-ink">接口</h2>
        <ul className="mt-3 divide-y divide-line rounded-md border border-line bg-surface">
          {ENDPOINTS.map((e) => (
            <li key={e.path} className="px-4 py-3">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="rounded-sm border border-line px-1.5 py-0.5 text-[11px] text-ink-3">{e.method}</span>
                <code className="text-[13px] text-ink">{e.path}</code>
              </div>
              <p className="mt-1 text-[13px] text-ink-3">{e.desc}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-ink">鉴权</h2>
        <p className="mt-2 text-[13px] text-ink-2">
          除 <code>/api/health</code> 外，所有接口要求{" "}
          <code className="text-ink">Authorization: Bearer &lt;DATA_SERVICE_KEY_CURRENT&gt;</code>
          。未带密钥 401，密钥错误 403。
        </p>
        <p className="mt-2 text-[13px] text-ink-3">
          完整说明见仓库 <code>docs/api.md</code> 与 README。
        </p>
      </section>
    </main>
  );
}
