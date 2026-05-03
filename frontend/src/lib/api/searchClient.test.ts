import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { SearchResponse } from "shared/wire";
import { searchClient, SearchClientError } from "./searchClient";

const successBody: SearchResponse = {
  results: [],
  meta: { latencyMs: 0, stagesRan: [], extracted: { description: "" } },
};

describe("searchClient", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("attaches the x-api-key header and never sets Content-Type", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(successBody), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const file = new File(["x"], "x.jpg", { type: "image/jpeg" });
    await searchClient({ apiKey: "secret-key", image: file });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0];
    const headers = init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("secret-key");
    // Caller MUST NOT set Content-Type — browser sets multipart boundary.
    expect(
      Object.keys(headers).map((k) => k.toLowerCase()),
    ).not.toContain("content-type");
  });

  it("builds a multipart body containing the image and optional prompt", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(successBody), { status: 200 }),
    );

    const file = new File(["pixels"], "couch.png", { type: "image/png" });
    await searchClient({
      apiKey: "key",
      image: file,
      prompt: "modern leather",
    });

    const [, init] = fetchMock.mock.calls[0];
    const body = init.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    const imagePart = body.get("image");
    expect(imagePart).toBeInstanceOf(File);
    expect((imagePart as File).name).toBe("couch.png");
    expect(body.get("prompt")).toBe("modern leather");
  });

  it("omits the prompt field when none was supplied", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(successBody), { status: 200 }),
    );

    const file = new File(["x"], "x.jpg", { type: "image/jpeg" });
    await searchClient({ apiKey: "key", image: file });

    const [, init] = fetchMock.mock.calls[0];
    const body = init.body as FormData;
    expect(body.has("prompt")).toBe(false);
  });

  it("parses ApiError JSON on non-2xx and throws a typed SearchClientError", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ code: "PROVIDER_ERROR", message: "Upstream blew up" }),
        { status: 502, headers: { "Content-Type": "application/json" } },
      ),
    );

    const file = new File(["x"], "x.jpg", { type: "image/jpeg" });
    await expect(
      searchClient({ apiKey: "key", image: file }),
    ).rejects.toMatchObject({
      name: "SearchClientError",
      code: "PROVIDER_ERROR",
      message: "Upstream blew up",
      status: 502,
    });
  });

  it("falls back to a generic SearchClientError when the body is not parseable", async () => {
    fetchMock.mockResolvedValue(new Response("oops", { status: 500 }));

    const file = new File(["x"], "x.jpg", { type: "image/jpeg" });
    await expect(
      searchClient({ apiKey: "key", image: file }),
    ).rejects.toBeInstanceOf(SearchClientError);
  });
});
