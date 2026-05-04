import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { AdminConfig, HistoryResponse } from "shared/wire";
import {
  AdminClientError,
  getAdminConfig,
  getAdminHistory,
  resetAdminConfig,
  updateAdminConfig,
} from "./adminClient";

const baseConfig: AdminConfig = {
  topK: 20,
  rerank: true,
  provider: "openai",
  visionModel: "gpt-4o-mini",
  visionPrompt: "vp",
  rerankModel: "gpt-4o-mini",
  rerankPrompt: "rp",
  rerankTopN: 10,
};

const emptyHistory: HistoryResponse = { rows: [] };

describe("adminClient", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("getAdminConfig sends GET /admin/config with x-admin-password header", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(baseConfig), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await getAdminConfig("hunter2");
    expect(result).toEqual(baseConfig);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/admin\/config$/);
    expect(init.method ?? "GET").toBe("GET");
    const headers = init.headers as Record<string, string>;
    expect(headers["x-admin-password"]).toBe("hunter2");
  });

  it("updateAdminConfig sends POST /admin/config with JSON body and the header", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ...baseConfig, topK: 5 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await updateAdminConfig("pw", { topK: 5 });
    expect(result.topK).toBe(5);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/admin\/config$/);
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["x-admin-password"]).toBe("pw");
    expect(headers["Content-Type"] ?? headers["content-type"]).toMatch(
      /application\/json/,
    );
    expect(JSON.parse(init.body as string)).toEqual({ topK: 5 });
  });

  it("resetAdminConfig sends POST /admin/config/reset with the header", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(baseConfig), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await resetAdminConfig("pw");
    expect(result).toEqual(baseConfig);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/admin\/config\/reset$/);
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["x-admin-password"]).toBe("pw");
  });

  it("getAdminHistory sends GET /admin/history with the header", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(emptyHistory), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const result = await getAdminHistory("pw");
    expect(result).toEqual(emptyHistory);

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/\/admin\/history$/);
    expect(init.method ?? "GET").toBe("GET");
    const headers = init.headers as Record<string, string>;
    expect(headers["x-admin-password"]).toBe("pw");
  });

  it("throws AdminClientError on non-2xx with body { code, message }", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          code: "ADMIN_AUTH_INVALID",
          message: "Invalid admin password.",
        }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      ),
    );

    await expect(getAdminConfig("bad")).rejects.toMatchObject({
      name: "AdminClientError",
      code: "ADMIN_AUTH_INVALID",
      message: "Invalid admin password.",
      status: 401,
    });
  });

  it("throws AdminClientError with code: 'UNKNOWN' on non-JSON body", async () => {
    fetchMock.mockResolvedValue(new Response("oh no", { status: 500 }));

    const err = await getAdminConfig("pw").catch((e) => e);
    expect(err).toBeInstanceOf(AdminClientError);
    expect((err as AdminClientError).code).toBe("UNKNOWN");
    expect((err as AdminClientError).status).toBe(500);
  });
});
