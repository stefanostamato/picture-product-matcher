import { describe, it, expect, expectTypeOf } from "vitest";
import type { Product } from "./catalog";
import type {
  AdminConfig,
  AdminConfigUpdate,
  AdminErrorCodes,
  ApiError,
  ExtractedAttributes,
  HistoryResponse,
  HistoryRow,
  SearchRequest,
  SearchResponse,
} from "./wire";

describe("wire types", () => {
  it("SearchResponse accepts a fixture with all fields", () => {
    const product: Product = {
      _id: "65fa1b2c3d4e5f6a7b8c9d01",
      title: "Modern Leather Dining Bench",
      description: "Natural modern dining bench made from premium leather.",
      category: "Benches",
      type: "Dining Bench",
      price: 269.99,
      width: 140,
      height: 45,
      depth: 38,
    };

    const extracted: ExtractedAttributes = {
      category: "Benches",
      type: "Dining Bench",
      style: "modern",
      material: "leather",
      color: "natural",
      description: "A modern leather dining bench with metal legs.",
      dimensions: { width: 140, height: 45, depth: 38 },
      priceBand: "mid",
    };

    const response: SearchResponse = {
      results: [product],
      meta: {
        latencyMs: 1234,
        stagesRan: ["visionExtract", "queryBuild", "catalogSearch"],
        extracted,
        tokens: { prompt: 100, completion: 50, total: 150 },
        costUsd: 0.000123,
        topResults: [
          { productId: "65fa1b2c3d4e5f6a7b8c9d01", score: 4.5 },
          { productId: "65fa1b2c3d4e5f6a7b8c9d02", score: 3.2 },
          { productId: "65fa1b2c3d4e5f6a7b8c9d03", score: 1.7 },
        ],
      },
    };

    expect(response.results).toHaveLength(1);
    expect(response.meta.stagesRan).toContain("visionExtract");
    expect(response.meta.extracted.category).toBe("Benches");
    expect(response.meta.tokens.total).toBe(150);
    expect(response.meta.costUsd).toBeCloseTo(0.000123, 6);
    expect(response.meta.topResults).toHaveLength(3);
    expect(response.meta.topResults[0]?.productId).toBe(
      "65fa1b2c3d4e5f6a7b8c9d01",
    );
  });

  it("SearchResponseMeta requires tokens, costUsd, and topResults", () => {
    const extracted: ExtractedAttributes = {
      description: "A wooden chair.",
    };

    // @ts-expect-error - `tokens` is required on SearchResponseMeta
    const missingTokens: SearchResponse["meta"] = {
      latencyMs: 10,
      stagesRan: [],
      extracted,
      costUsd: 0,
      topResults: [],
    };
    expect(missingTokens.costUsd).toBe(0);

    // @ts-expect-error - `costUsd` is required on SearchResponseMeta
    const missingCost: SearchResponse["meta"] = {
      latencyMs: 10,
      stagesRan: [],
      extracted,
      tokens: { prompt: 0, completion: 0, total: 0 },
      topResults: [],
    };
    expect(missingCost.tokens.total).toBe(0);

    // @ts-expect-error - `topResults` is required on SearchResponseMeta
    const missingTop: SearchResponse["meta"] = {
      latencyMs: 10,
      stagesRan: [],
      extracted,
      tokens: { prompt: 0, completion: 0, total: 0 },
      costUsd: 0,
    };
    expect(missingTop.tokens.total).toBe(0);
  });

  it("SearchResponseMeta accepts an empty topResults array", () => {
    const extracted: ExtractedAttributes = {
      description: "Nothing matched.",
    };
    const meta: SearchResponse["meta"] = {
      latencyMs: 42,
      stagesRan: ["visionExtract", "catalogSearch"],
      extracted,
      tokens: { prompt: 10, completion: 0, total: 10 },
      costUsd: 0,
      topResults: [],
      lowConfidence: true,
    };
    expect(meta.topResults).toEqual([]);
    expect(meta.lowConfidence).toBe(true);
  });

  it("ExtractedAttributes allows the optional fields to be omitted", () => {
    const minimal: ExtractedAttributes = {
      description: "An unidentifiable wooden object.",
    };
    expect(minimal.description).toMatch(/wooden/);
  });

  it("SearchRequest carries the documented fields", () => {
    const req: SearchRequest = {
      image: new Uint8Array([0xff, 0xd8, 0xff]),
      mimeType: "image/jpeg",
      prompt: "something cosy",
    };
    expect(req.mimeType).toBe("image/jpeg");
    expectTypeOf<SearchRequest["prompt"]>().toEqualTypeOf<string | undefined>();
  });

  it("ApiError shape requires code and message", () => {
    const err: ApiError = { code: "PROVIDER_ERROR", message: "boom" };
    expect(err.code).toBe("PROVIDER_ERROR");

    // @ts-expect-error - `code` is required on ApiError
    const broken: ApiError = { message: "missing code" };
    expect(broken.message).toBe("missing code");
  });
});

describe("admin wire types", () => {
  const config: AdminConfig = {
    topK: 20,
    rerank: true,
    provider: "openai",
    visionModel: "gpt-4o-mini",
    visionPrompt: "You are a furniture vision system.",
    rerankModel: "gpt-4o-mini",
    rerankPrompt: "You are a furniture-catalog reranker.",
    rerankTopN: 10,
  };

  it("AdminConfig accepts the documented shape", () => {
    expect(config.provider).toBe("openai");
    expectTypeOf<AdminConfig["provider"]>().toEqualTypeOf<"openai">();
  });

  it("AdminConfigUpdate accepts a single key", () => {
    const patch: AdminConfigUpdate = { topK: 5 };
    expect(patch.topK).toBe(5);
  });

  it("AdminConfigUpdate accepts an empty object", () => {
    const patch: AdminConfigUpdate = {};
    expect(Object.keys(patch)).toHaveLength(0);
  });

  it("HistoryRow accepts a fully-populated literal", () => {
    const row: HistoryRow = {
      ts: "2026-05-03T12:34:56.000Z",
      gitSha: "abc1234def5678",
      gitDirty: false,
      goldSetVersion: "v1",
      n: 30,
      config,
      metrics: {
        recallAt1: 0.4,
        recallAt5: 0.7,
        recallAt20: 0.9,
        mrr: 0.55,
        meanAttributeOverlap: 0.6,
        categoryHitRate: 0.85,
        typeHitRate: 0.7,
        p50LatencyMs: 1200,
        p95LatencyMs: 2400,
        totalTokens: 12345,
        totalCostUsd: 0.0456,
        failureCounts: { PROVIDER_ERROR: 1 },
      },
      byCategory: {
        Sofas: { recallAt5: 0.8, mrr: 0.6 },
        Benches: { recallAt5: 0.5 },
      },
    };
    expect(row.metrics.recallAt5).toBeCloseTo(0.7);
    expect(row.byCategory.Sofas?.recallAt5).toBeCloseTo(0.8);
    expect(row.config.visionModel).toBe("gpt-4o-mini");
  });

  it("HistoryRow rejects missing required metrics fields", () => {
    const broken: HistoryRow = {
      ts: "2026-05-03T12:34:56.000Z",
      gitSha: "abc1234",
      gitDirty: false,
      goldSetVersion: "v1",
      n: 1,
      config,
      // @ts-expect-error - `recallAt5` is required on HistoryRow.metrics
      metrics: {
        recallAt1: 0,
        recallAt20: 0,
        mrr: 0,
        meanAttributeOverlap: 0,
        categoryHitRate: 0,
        typeHitRate: 0,
        p50LatencyMs: 0,
        p95LatencyMs: 0,
        totalTokens: 0,
        totalCostUsd: 0,
        failureCounts: {},
      },
      byCategory: {},
    };
    expect(broken.gitSha).toBe("abc1234");
  });

  it("HistoryResponse accepts an empty rows array", () => {
    const response: HistoryResponse = { rows: [] };
    expect(response.rows).toEqual([]);
  });

  it("AdminErrorCodes union includes the documented codes", () => {
    const required: AdminErrorCodes = "ADMIN_AUTH_REQUIRED";
    const invalid: AdminErrorCodes = "ADMIN_AUTH_INVALID";
    const configInvalid: AdminErrorCodes = "ADMIN_CONFIG_INVALID";
    const unavailable: AdminErrorCodes = "ADMIN_HISTORY_UNAVAILABLE";
    expect([required, invalid, configInvalid, unavailable]).toHaveLength(4);
  });
});
