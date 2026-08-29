# zmzai-data API 参考（v1）

基址：`https://d.zmzai.cloud`（本地 `http://127.0.0.1:3004`）

## 鉴权

除 `/api/health` 外，所有接口都要求服务密钥：

```bash
Authorization: Bearer <DATA_SERVICE_KEY_CURRENT>
# 或等价的：x-service-key: <DATA_SERVICE_KEY_CURRENT>
```

| 情况 | 状态码 | code |
| --- | --- | --- |
| 未带密钥 | 401 | `UNAUTHORIZED` |
| 密钥错误 | 403 | `FORBIDDEN` |
| 服务端未配置任何密钥（fail closed） | 403 | `SERVICE_KEY_NOT_CONFIGURED` |

建议调用方额外带 `x-zmzai-caller: <服务名>`，用于用量日志归因（不参与鉴权）。

## 标的代码

规范化规则大小写与后缀不敏感，出口统一为「规范代码」：

| 输入 | 规范代码 | 市场 |
| --- | --- | --- |
| `600519` / `600519.SH` / `sh600519` | `600519` | A股 |
| `000001` / `000001.SZ` | `000001` | A股 |
| `BTC` / `btc` / `BTCUSDT` | `BTC` | 加密 |

规范代码与 zmzai-arena 的 `INSTRUMENT_MAP` key 一一对应，arena 可直接用于回测。

## `GET /api/health`

公开接口。`?probe=1` 会真正探测上游（否则只报配置状态）。

```json
{
  "ok": true,
  "service": "zmzai-data",
  "auth": "configured",
  "probe": false,
  "deps": {
    "tushare": { "market": "A股", "configured": false, "status": "unconfigured" },
    "binance": { "market": "加密", "configured": true, "status": "unknown" }
  },
  "now": "2026-08-29T14:00:00.000Z"
}
```

`tushare.configured=false` 不会让 `ok` 变 false（A股源是可选依赖），但 A股接口会返回 503。

## `GET /api/v1/quotes/:symbol`

```bash
curl -H "Authorization: Bearer $KEY" \
  https://d.zmzai.cloud/api/v1/quotes/BTC
```

```json
{
  "provider": "binance",
  "cached": false,
  "quote": {
    "symbol": "BTC",
    "market": "加密",
    "price": 78038,
    "prevClose": 79487.71,
    "change": -1449.71,
    "changePct": -0.01824,
    "date": "2026-08-28",
    "currency": "USDT",
    "source": "binance"
  }
}
```

`changePct` 是小数（`-0.01824` = -1.824%），不是百分数。

## `GET /api/v1/bars/:symbol`

| 参数 | 取值 | 默认 | 说明 |
| --- | --- | --- | --- |
| `range` | `1m` `3m` `6m` `1y` | `1y` | 往前推的自然日窗口 |
| `limit` | 1–1000 整数 | 全部 | 取最近 N 根 |

```bash
curl -H "Authorization: Bearer $KEY" \
  "https://d.zmzai.cloud/api/v1/bars/600519?range=6m&limit=120"
```

```json
{
  "symbol": "600519",
  "market": "A股",
  "range": "6m",
  "limit": 120,
  "provider": "tushare",
  "cached": false,
  "count": 120,
  "bars": [
    { "date": "2026-08-28", "open": 10.1, "high": 10.8, "low": 10, "close": 10.5, "volume": 123450 }
  ]
}
```

约定：

- **升序**（早 → 晚），`date` 为 `yyyy-mm-dd`（A股 = 交易日，加密 = UTC 自然日）
- 价格单位：A股 元 / 加密 USDT
- 成交量单位：标的原生数量。A股 Tushare 原始「手」已 ×100 归一为**股**；加密为**币**
- `cached: true` 表示命中进程内 TTL 缓存，未打上游

## `GET /api/v1/fundamentals/:symbol`

v1 只有最小字段（市值 / 24h 成交额）。深度财务三表不在范围内。

- 加密：`marketCap` 恒为 `null`（TODO：市值源），`volume24h` 取 24h 成交额
- A股：v1 未实现 → `501 NOT_IMPLEMENTED`

## 错误码

| HTTP | code | 含义 |
| --- | --- | --- |
| 400 | `INVALID_SYMBOL` / `INVALID_RANGE` / `INVALID_LIMIT` | 参数不合法 |
| 401 / 403 | `UNAUTHORIZED` / `FORBIDDEN` / `SERVICE_KEY_NOT_CONFIGURED` | 鉴权 |
| 404 | `NOT_FOUND` / `NO_DATA` | 标的不存在 / 区间内无数据 |
| 429 | `RATE_LIMITED` | 本服务限频或上游限频 |
| 501 | `NOT_IMPLEMENTED` | 该市场的基本面 v1 未提供 |
| 502 | `BAD_UPSTREAM` | 上游返回无法解析的数据 |
| 503 | `UNAVAILABLE` | 上游不可达 / 超时 / 数据源未配置（如缺 `TUSHARE_TOKEN`） |

失败响应统一格式：

```json
{ "code": "UNAVAILABLE", "error": "A股数据源未配置：请设置 TUSHARE_TOKEN", "symbol": "600519", "provider": "tushare" }
```

## 限频与缓存

- 进程内 TTL 缓存：历史日线 6h（`CACHE_HISTORY_TTL_MS`），含当日数据窗口 60s（`CACHE_TODAY_TTL_MS`）
- token bucket 限频：tushare 默认 2 req/s、binance 10 req/s（`RATE_LIMIT_*_RPS`）
- 多源 failover：按 `providersFor()` 的顺序降级；`NOT_FOUND` / `UNAUTHORIZED` 不重试下一个源
- Binance 额外有域名级 failover（默认 `data-api.binance.vision` 兜底）
