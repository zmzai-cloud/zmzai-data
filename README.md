# zmzai-data

统一行情服务 —— 给 zmzai 生态（arena / agent / relay …）提供 A股与加密的日线 / 报价 API。

`https://d.zmzai.cloud` · 本地 `http://127.0.0.1:3004`

## 职责

- **统一收口行情源**：调用方不必各自对接 Tushare / Binance，也不用各自处理限频、缓存、降级。
- **稳定契约**：Bar / Quote 结构与 zmzai-arena 仿真引擎对齐，arena 可直接拿去跑回测。
- **保护上游**：进程内 TTL 缓存 + token bucket 限频 + 多源 failover。

## 边界（不做的事）

- ❌ 美股 / 港股 / 期货数据源（v1 只有 A股 + 加密，美股二期）
- ❌ 深度基本面（财务三表）；v1 `fundamentals` 只给市值 / 24h 成交额
- ❌ 实时 tick / 分钟级推送（v1 只做日线）
- ❌ 真实交易 / 下单（这是行情服务，不是券商通道）
- ❌ 用户态鉴权（只有服务间 service-key；用户侧会话归 zmzai-auth）

## 目录

```
zmzai-data/
├── app/
│   ├── api/
│   │   ├── health/route.ts              # 健康检查（公开，?probe=1 探上游）
│   │   └── v1/
│   │       ├── bars/[symbol]/route.ts   # 日线 K 线
│   │       ├── quotes/[symbol]/route.ts # 最新报价
│   │       └── fundamentals/[symbol]/route.ts
│   ├── globals.css                      # @zmzai/theme tokens + fonts
│   └── page.tsx                         # 接口索引页
├── config/env.ts          # zod 环境变量白名单（未声明的变量一律忽略）
├── lib/
│   ├── providers/
│   │   ├── interface.ts   # MarketDataProvider 抽象 + Bar/Quote 契约 + ProviderError
│   │   ├── tushare.ts     # A股日线（需 TUSHARE_TOKEN）
│   │   └── binance.ts     # 加密 USDT 现货（公开 REST + 域名级 failover）
│   ├── market-service.ts  # 路由层：选源 → 限频 → 缓存 → failover → 用量日志
│   ├── cache.ts           # 进程内 TTL 缓存（历史 6h / 当日 60s）
│   ├── ratelimit.ts       # token bucket
│   ├── auth.ts            # service-key 鉴权（current/previous 轮换 + 定长比较）
│   ├── usage.ts           # 取数用量日志（等 @zmzai/contracts 后改为事件上报）
│   ├── store.ts           # 持久化存储接口（v1 Noop，TODO: Mongo）
│   ├── http.ts            # 上游 HTTP 封装（超时 / 错误归类）
│   ├── symbol.ts          # 标的代码归一化（与 arena INSTRUMENT_MAP 对齐）
│   └── api.ts             # 路由共享工具（鉴权拦截 / 参数解析 / 错误映射）
├── tests/                 # vitest
└── docs/api.md            # API 参考
```

## 本地运行

```bash
pnpm install
cp .env.example .env.local   # 至少填 DATA_SERVICE_KEY_CURRENT
pnpm dev                     # http://127.0.0.1:3004
```

常用命令：

```bash
pnpm typecheck   # tsc --noEmit
pnpm test        # vitest run
pnpm build       # next build
```

### 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `DATA_SERVICE_KEY_CURRENT` | — | 当前服务密钥（**必填**，否则所有接口 403） |
| `DATA_SERVICE_KEY_PREVIOUS` | — | 上一个密钥，轮换期双密钥并存 |
| `TUSHARE_TOKEN` | — | A股数据源 token；未配置时 A股接口 503（不静默降级） |
| `TUSHARE_API_URL` | `http://api.waditu.com` | Tushare 网关 |
| `BINANCE_API_BASE` | `https://api.binance.com` | 加密主域名 |
| `BINANCE_FALLBACK_BASES` | `https://data-api.binance.vision` | 逗号分隔的备用域名 |
| `CACHE_HISTORY_TTL_MS` | `21600000` | 历史日线缓存 6h |
| `CACHE_TODAY_TTL_MS` | `60000` | 含当日数据的窗口缓存 60s |
| `RATE_LIMIT_TUSHARE_RPS` | `2` | A股源每秒令牌数 |
| `RATE_LIMIT_BINANCE_RPS` | `10` | 加密源每秒令牌数 |
| `HTTP_TIMEOUT_MS` | `10000` | 上游超时 |

## curl 示例

```bash
export KEY=<DATA_SERVICE_KEY_CURRENT>
export DATA=http://127.0.0.1:3004

# 健康检查（无需密钥）
curl -s "$DATA/api/health" | jq
curl -s "$DATA/api/health?probe=1" | jq   # 真正探测上游

# 加密日线（无需任何 token）
curl -s -H "Authorization: Bearer $KEY" "$DATA/api/v1/bars/BTC?range=1m&limit=5" | jq
curl -s -H "Authorization: Bearer $KEY" "$DATA/api/v1/quotes/ETH" | jq

# A股日线（需要 TUSHARE_TOKEN）
curl -s -H "Authorization: Bearer $KEY" "$DATA/api/v1/bars/600519?range=6m&limit=10" | jq
curl -s -H "Authorization: Bearer $KEY" "$DATA/api/v1/quotes/000001" | jq

# 未配置 TUSHARE_TOKEN 时的 A股响应
# HTTP 503 {"code":"UNAVAILABLE","error":"A股数据源未配置：请在 zmzai-data 的环境变量中设置 TUSHARE_TOKEN …"}
```

## 与其他模块的关系

- **zmzai-arena**：`dataSource=real` 的实盘回测调用本服务拉真实日线，归一化成引擎同款 Bars 快照后跑仿真。arena 通过 `DATA_ORIGIN` + `DATA_SERVICE_KEY` 访问。
- **zmzai-sandbox**：无直接关系（沙箱跑策略代码，不提供行情）。
- **zmzai-auth**：各站用户会话在那里，本服务只认服务密钥。

## 已知 TODO

- `@zmzai/contracts` 事件契约落地后，`lib/usage.ts` 改为上报 `UsageReported` 事件（现在只写本地结构化日志）
- Mongo 持久化存储层：接口已留（`lib/store.ts`），v1 用 `NoopBarStore`
- A股前复权（现为不复权收盘价）、美股数据源
