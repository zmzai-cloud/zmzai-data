import { afterEach, describe, expect, it } from "vitest";

import { authorizeRequest, extractServiceKey, serviceKeyConfigured } from "@/lib/auth";
import { setupEnv } from "./helpers";

afterEach(() => {
  setupEnv({ DATA_SERVICE_KEY_CURRENT: undefined, DATA_SERVICE_KEY_PREVIOUS: undefined });
});

function req(headers: Record<string, string>): Request {
  return new Request("https://d.zmzai.cloud/api/v1/bars/BTC", { headers });
}

describe("extractServiceKey", () => {
  it("支持 Bearer 与 x-service-key 两种写法", () => {
    expect(extractServiceKey(req({ authorization: "Bearer abc" }))).toBe("abc");
    expect(extractServiceKey(req({ "x-service-key": "abc" }))).toBe("abc");
    expect(extractServiceKey(req({}))).toBeNull();
    expect(extractServiceKey(req({ authorization: "Basic abc" }))).toBeNull();
  });
});

describe("authorizeRequest", () => {
  it("无密钥 → 401", () => {
    setupEnv({ DATA_SERVICE_KEY_CURRENT: "k1" });
    const r = authorizeRequest(req({}));
    expect(r).toMatchObject({ ok: false, status: 401, code: "UNAUTHORIZED" });
  });

  it("服务端未配置密钥 → 403（fail closed）", () => {
    const r = authorizeRequest(req({ authorization: "Bearer whatever" }));
    expect(r).toMatchObject({ ok: false, status: 403, code: "SERVICE_KEY_NOT_CONFIGURED" });
  });

  it("密钥不匹配 → 403", () => {
    setupEnv({ DATA_SERVICE_KEY_CURRENT: "k1" });
    const r = authorizeRequest(req({ authorization: "Bearer nope" }));
    expect(r).toMatchObject({ ok: false, status: 403, code: "FORBIDDEN" });
  });

  it("current / previous 都接受（轮换期）", () => {
    setupEnv({ DATA_SERVICE_KEY_CURRENT: "k1", DATA_SERVICE_KEY_PREVIOUS: "k0" });
    expect(authorizeRequest(req({ authorization: "Bearer k1" })).ok).toBe(true);
    expect(authorizeRequest(req({ authorization: "Bearer k0" })).ok).toBe(true);
  });

  it("空字符串视为未配置", () => {
    setupEnv({ DATA_SERVICE_KEY_CURRENT: "   " });
    expect(serviceKeyConfigured()).toBe(false);
  });
});
