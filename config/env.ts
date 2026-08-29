import { z } from "zod";

/**
 * 环境变量白名单：未在 schema 中声明的变量一律忽略（避免拼写错误悄悄生效）。
 * 用法与 zmzai-memory/config/env.ts 一致——解析结果缓存，进程内只读一次。
 */

function optionalEnvString() {
  return z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.string().optional(),
  );
}

/** 逗号分隔字符串 → 去空白后的数组 */
function csv(defaultValue: string[]) {
  return z.preprocess(
    (v) =>
      typeof v === "string"
        ? v
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : v,
    z.array(z.string().url()).default(defaultValue),
  );
}

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.string().url().default("http://localhost:3004"),

  /** 服务间调用密钥（当前 / 上一个，支持轮换期双密钥并存） */
  DATA_SERVICE_KEY_CURRENT: optionalEnvString(),
  DATA_SERVICE_KEY_PREVIOUS: optionalEnvString(),

  /** A股：Tushare Pro token。未配置 → A股接口返回 503 明确提示，不静默降级。 */
  TUSHARE_TOKEN: optionalEnvString(),
  TUSHARE_API_URL: z.string().url().default("http://api.waditu.com"),

  /** 加密：Binance 公开 REST（USDT 现货），无需 key */
  BINANCE_API_BASE: z.string().url().default("https://api.binance.com"),
  BINANCE_FALLBACK_BASES: csv(["https://data-api.binance.vision"]),

  /** 缓存 TTL：历史日线 6h，含当日数据的窗口 60s */
  CACHE_HISTORY_TTL_MS: z.coerce.number().int().positive().default(6 * 60 * 60 * 1000),
  CACHE_TODAY_TTL_MS: z.coerce.number().int().positive().default(60 * 1000),

  /** token bucket：每源每秒补充的令牌数（尊重源站速率） */
  RATE_LIMIT_TUSHARE_RPS: z.coerce.number().positive().default(2),
  RATE_LIMIT_BINANCE_RPS: z.coerce.number().positive().default(10),

  HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
});

export type ServerEnv = z.infer<typeof envSchema>;

let cachedEnv: ServerEnv | undefined;

export function getServerEnv(): ServerEnv {
  cachedEnv ??= envSchema.parse(process.env);
  return cachedEnv;
}

/** 测试用：重置缓存（env 变更后重新解析） */
export function resetServerEnvCache(): void {
  cachedEnv = undefined;
}
