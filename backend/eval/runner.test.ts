import { describe, it, expect, vi } from "vitest";
import type { Product } from "shared/catalog";
import type { SearchResponse } from "shared/wire";
import { runEval, type RunEvalDeps, type RunPipelineFn } from "./runner.js";
import type { GoldItem } from "./types.js";

const product = (id: string, overrides: Partial<Product> = {}): Product => ({
  _id: id,
  title: `Title ${id}`,
  description: `Description ${id}`,
  category: "Sofas",
  type: "Sectional",
  price: 100,
  width: 200,
  height: 80,
  depth: 90,
  ...overrides,
});

const goldItem = (overrides: Partial<GoldItem> = {}): GoldItem => ({
  productId: "p1",
  category: "Sofas",
  type: "Sectional",
  title: "Gold Sofa",
  description: "A grey velvet sectional",
  color: ["grey"],
  material: ["velvet"],
  style: ["modern"],
  ...overrides,
});

const successResponse = (
  results: Product[],
  category: string,
  type: string,
): SearchResponse => ({
  results,
  meta: {
    latencyMs: 123,
    stagesRan: ["visionExtract", "queryBuild", "catalogSearch"],
    extracted: {
      category,
      type,
      color: "grey",
      material: "velvet",
      style: "modern",
      description: "stub",
    },
    tokens: { prompt: 10, completion: 5, total: 15 },
    costUsd: 0.0001,
    topResults: results.slice(0, 3).map((p, i) => ({
      productId: p._id,
      score: 1 - i * 0.1,
    })),
  },
});

describe("runEval", () => {
  it("iterates gold items and aggregates per-category metrics", async () => {
    const sofa = goldItem({ productId: "sofa-1", category: "Sofas", type: "Sectional" });
    const chair = goldItem({
      productId: "chair-1",
      category: "Chairs",
      type: "Lounge",
    });

    const loadGold = vi.fn(async () => [
      { item: sofa, image: Buffer.from([1, 2, 3]), mimeType: "image/jpeg" },
      { item: chair, image: Buffer.from([4, 5, 6]), mimeType: "image/jpeg" },
    ]);

    const runPipeline = vi.fn(async (input: { image: Buffer }) => {
      // Identify which item we're on by the image bytes.
      if (input.image[0] === 1) {
        return successResponse(
          [product("sofa-1"), product("other-sofa")],
          "Sofas",
          "Sectional",
        );
      }
      return successResponse(
        [product("other-chair"), product("chair-1")],
        "Chairs",
        "Lounge",
      );
    });

    const getConfig = vi.fn(() => ({
      topK: 20,
      rerank: false,
      provider: "openai" as const,
      visionModel: "gpt-4o-mini",
    }));

    const deps: RunEvalDeps = {
      runPipeline,
      loadGold,
      getConfig,
      apiKey: "sk-test",
      paceMs: 0,
    };

    const report = await runEval(deps);

    expect(loadGold).toHaveBeenCalledTimes(1);
    expect(runPipeline).toHaveBeenCalledTimes(2);
    expect(report.runs).toHaveLength(2);
    // Both targets present in their respective top-5 → recall@5 = 1.0
    expect(report.overall.recallAt5).toBe(1);
    // sofa hit at rank 1, chair at rank 2 → MRR = (1 + 0.5) / 2
    expect(report.overall.mrr).toBeCloseTo(0.75, 10);
    expect(Object.keys(report.byCategory).sort()).toEqual(["Chairs", "Sofas"]);
    expect(report.byCategory.Sofas.n).toBe(1);
    expect(report.byCategory.Chairs.n).toBe(1);
    expect(report.byCategory.Sofas.recallAt1).toBe(1);
    expect(report.byCategory.Chairs.recallAt1).toBe(0);
  });

  it("forwards image, mimeType, and apiKey to runPipeline", async () => {
    const item = goldItem();
    const loadGold = vi.fn(async () => [
      { item, image: Buffer.from("hello"), mimeType: "image/png" },
    ]);

    const runPipeline: ReturnType<typeof vi.fn<RunPipelineFn>> = vi.fn(
      async () =>
        successResponse([product(item.productId)], item.category, item.type),
    );

    const getConfig = vi.fn(() => ({
      topK: 20,
      rerank: false,
      provider: "openai" as const,
      visionModel: "gpt-4o-mini",
    }));

    await runEval({
      runPipeline,
      loadGold,
      getConfig,
      apiKey: "sk-runner-test",
      paceMs: 0,
    });

    expect(runPipeline).toHaveBeenCalledTimes(1);
    const call = runPipeline.mock.calls[0]?.[0];
    expect(call?.image).toBeInstanceOf(Buffer);
    expect(call?.mimeType).toBe("image/png");
    expect(call?.apiKey).toBe("sk-runner-test");
  });

  it("returns zeroed metrics when the gold set is empty", async () => {
    const report = await runEval({
      runPipeline: vi.fn(),
      loadGold: vi.fn(async () => []),
      getConfig: vi.fn(() => ({
        topK: 20,
        rerank: false,
        provider: "openai" as const,
        visionModel: "gpt-4o-mini",
      })),
      apiKey: "k",
    });

    expect(report.runs).toEqual([]);
    expect(report.overall.n).toBe(0);
    expect(report.byCategory).toEqual({});
  });
});
