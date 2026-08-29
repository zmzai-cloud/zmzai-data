// 服务间鉴权：只有持有 service-key 的 zmzai 内部服务（arena / agent / relay …）能调用。
//
// 模式与 zmzai-relay 的 providers/auth/agent-service.ts 一致：
//   - header: `Authorization: Bearer <key>`（也接受 `x-service-key: <key>`）
//   - 支持 current / previous 双密钥，便于无中断轮换
//   - 定长比较（timingSafeEqual），不做字符串 === 短路比较
//   - 未配置任何密钥时一律拒绝（fail closed），错误信息明确指出变量名

import { timingSafeEqual } from "node:crypto";

import { getServerEnv } from "@/config/env";

export type AuthResult = { ok: true } | { ok: false; status: 401 | 403; code: string; error: string };

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

function configuredKeys(): string[] {
  const env = getServerEnv();
  return [env.DATA_SERVICE_KEY_CURRENT, env.DATA_SERVICE_KEY_PREVIOUS].filter(
    (v): v is string => Boolean(v && v.trim()),
  );
}

/** 从请求头取 service-key */
export function extractServiceKey(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    const v = auth.slice(7).trim();
    if (v) return v;
  }
  const alt = req.headers.get("x-service-key");
  return alt?.trim() ? alt.trim() : null;
}

/** 校验 service-key；通过返回 ok，否则带 HTTP 状态与错误码 */
export function authorizeRequest(req: Request): AuthResult {
  const provided = extractServiceKey(req);
  if (!provided) {
    return {
      ok: false,
      status: 401,
      code: "UNAUTHORIZED",
      error: "缺少 service-key：请用 Authorization: Bearer <DATA_SERVICE_KEY_CURRENT>",
    };
  }
  const keys = configuredKeys();
  if (keys.length === 0) {
    return {
      ok: false,
      status: 403,
      code: "SERVICE_KEY_NOT_CONFIGURED",
      error: "服务端未配置 DATA_SERVICE_KEY_CURRENT，拒绝所有调用",
    };
  }
  if (!keys.some((k) => safeEqual(k, provided))) {
    return { ok: false, status: 403, code: "FORBIDDEN", error: "service-key 不正确" };
  }
  return { ok: true };
}

/** 服务密钥是否已配置（/api/health 用） */
export function serviceKeyConfigured(): boolean {
  return configuredKeys().length > 0;
}
