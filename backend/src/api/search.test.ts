import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import type { SearchResponse } from "shared/wire";
import type { Product } from "shared/catalog";

// Mock the pipeline before importing the app — the route layer depends on it.
vi.mock("../pipeline/run.js", () => ({
  runPipeline: vi.fn(),
}));

// Mock the singletons the route assembles its deps from so tests stay
// hermetic. The route only forwards them into runPipeline, which is mocked.
vi.mock("../providers/index.js", async () => {
  const actual = await vi.importActual<typeof import("../providers/index.js")>(
    "../providers/index.js",
  );
  return {
    ...actual,
    getProvider: vi.fn(() => ({
      name: "openai",
      extractFromImage: vi.fn(),
    })),
  };
});

vi.mock("../catalog/index.js", () => ({
  searchCatalog: vi.fn(),
}));

vi.mock("../config/store.js", () => ({
  getConfig: vi.fn(() => ({
    topK: 20,
    rerank: false,
    provider: "openai",
    visionModel: "gpt-4o-mini",
  })),
}));

vi.mock("../metrics/collector.js", () => ({
  createMetrics: vi.fn(() => ({
    stage: () => () => undefined,
    finalize: () => ({ latencyMs: 0, stagesRan: [] }),
  })),
}));

import { app } from "../app.js";
import { runPipeline } from "../pipeline/run.js";
import { ProviderError } from "../providers/index.js";

const runPipelineMock = vi.mocked(runPipeline);

// 16-byte buffer that begins with the JPEG SOI (0xFFD8FF) so multer's
// content sniffing accepts it as `image/jpeg`.
const TINY_JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01,
  0x00, 0x00, 0x01,
]);

function product(id: string): Product {
  return {
    _id: id,
    title: `Product ${id}`,
    description: "desc",
    category: "Sofas",
    type: "Sectional",
    price: 100,
    width: 1,
    height: 1,
    depth: 1,
  };
}

const happyResponse: SearchResponse = {
  results: [product("a")],
  meta: {
    latencyMs: 12,
    stagesRan: ["visionExtract", "queryBuild", "catalogSearch"],
    extracted: { description: "modern sofa" },
    tokens: { prompt: 0, completion: 0, total: 0 },
    costUsd: 0,
    topResults: [],
  },
};

describe("POST /search", () => {
  beforeEach(() => {
    runPipelineMock.mockReset();
  });

  it("returns 200 with the pipeline's SearchResponse on the happy path", async () => {
    runPipelineMock.mockResolvedValue(happyResponse);

    const res = await request(app)
      .post("/search")
      .set("x-api-key", "sk-test-123")
      .field("prompt", "rustic")
      .attach("image", TINY_JPEG, {
        filename: "photo.jpg",
        contentType: "image/jpeg",
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual(happyResponse);

    const callArgs = runPipelineMock.mock.calls[0]?.[0];
    expect(callArgs?.apiKey).toBe("sk-test-123");
    expect(callArgs?.mimeType).toBe("image/jpeg");
    expect(callArgs?.prompt).toBe("rustic");
    expect(Buffer.isBuffer(callArgs?.image)).toBe(true);
    expect(callArgs?.image.length).toBe(TINY_JPEG.length);
  });

  it("returns 400 with MISSING_API_KEY when the x-api-key header is absent", async () => {
    const res = await request(app)
      .post("/search")
      .attach("image", TINY_JPEG, {
        filename: "photo.jpg",
        contentType: "image/jpeg",
      });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: "MISSING_API_KEY" });
    expect(typeof res.body.message).toBe("string");
    expect(runPipelineMock).not.toHaveBeenCalled();
  });

  it("returns 400 with MISSING_IMAGE when no image part is present", async () => {
    const res = await request(app)
      .post("/search")
      .set("x-api-key", "sk-test")
      .field("prompt", "anything");

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: "MISSING_IMAGE" });
    expect(runPipelineMock).not.toHaveBeenCalled();
  });

  it("returns 413 with IMAGE_TOO_LARGE when the upload exceeds 8MB", async () => {
    // 8MB + 1 byte; first three bytes form a valid JPEG SOI so the mime
    // filter doesn't reject before the size limit triggers.
    const oversized = Buffer.alloc(8 * 1024 * 1024 + 1, 0x00);
    oversized[0] = 0xff;
    oversized[1] = 0xd8;
    oversized[2] = 0xff;

    const res = await request(app)
      .post("/search")
      .set("x-api-key", "sk-test")
      .attach("image", oversized, {
        filename: "big.jpg",
        contentType: "image/jpeg",
      });

    expect(res.status).toBe(413);
    expect(res.body).toMatchObject({ code: "IMAGE_TOO_LARGE" });
    expect(runPipelineMock).not.toHaveBeenCalled();
  });

  it("returns 415 with UNSUPPORTED_MEDIA_TYPE for a non-image part", async () => {
    const res = await request(app)
      .post("/search")
      .set("x-api-key", "sk-test")
      .attach("image", Buffer.from("hello world", "utf8"), {
        filename: "note.txt",
        contentType: "text/plain",
      });

    expect(res.status).toBe(415);
    expect(res.body).toMatchObject({ code: "UNSUPPORTED_MEDIA_TYPE" });
    expect(runPipelineMock).not.toHaveBeenCalled();
  });

  it("returns 502 with PROVIDER_ERROR when the pipeline throws a generic ProviderError", async () => {
    runPipelineMock.mockRejectedValue(
      new ProviderError({
        code: "PROVIDER_HTTP_ERROR",
        message: "Upstream provider failed.",
      }),
    );

    const res = await request(app)
      .post("/search")
      .set("x-api-key", "sk-test")
      .attach("image", TINY_JPEG, {
        filename: "photo.jpg",
        contentType: "image/jpeg",
      });

    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ code: "PROVIDER_ERROR" });
  });

  it("returns 422 with UNRECOGNIZED_IMAGE when the provider can't read the image", async () => {
    runPipelineMock.mockRejectedValue(
      new ProviderError({
        code: "UNRECOGNIZED_IMAGE",
        message: "We couldn't read this image.",
      }),
    );

    const res = await request(app)
      .post("/search")
      .set("x-api-key", "sk-test")
      .attach("image", TINY_JPEG, {
        filename: "photo.jpg",
        contentType: "image/jpeg",
      });

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ code: "UNRECOGNIZED_IMAGE" });
  });

  it("never includes the API key in any error response body", async () => {
    const apiKey = "sk-super-secret-9f8a7b6c5d4e";
    runPipelineMock.mockRejectedValue(
      new ProviderError({
        code: "PROVIDER_HTTP_ERROR",
        // Even if a malicious / careless internal error embeds the key in
        // its message, the API boundary must scrub it before responding.
        message: `Provider rejected key ${apiKey} (rate limit).`,
      }),
    );

    const res = await request(app)
      .post("/search")
      .set("x-api-key", apiKey)
      .attach("image", TINY_JPEG, {
        filename: "photo.jpg",
        contentType: "image/jpeg",
      });

    expect(res.status).toBe(502);
    expect(JSON.stringify(res.body)).not.toContain(apiKey);
  });
});
