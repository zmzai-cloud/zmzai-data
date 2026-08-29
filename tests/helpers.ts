// 测试辅助：环境变量在 import 之后仍需可改（getServerEnv 有缓存），
// 因此每个用例先写 process.env 再 resetServerEnvCache()。

import { resetServerEnvCache } from "@/config/env";

export function setupEnv(patch: Record<string, string | undefined>): void {
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetServerEnvCache();
}

/** 构造一个最小 Response（只用到 ok/status/json/text） */
export function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}
