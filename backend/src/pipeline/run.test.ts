import { describe, it, expect, vi } from "vitest";
import type { Product } from "shared/catalog";
import type { ExtractedAttributes } from "shared/wire";
import type { Provider } from "../providers/index.js";
import type { ProviderUsage } from "../providers/types.js";
import { ProviderError } from "../providers/index.js";
import { priceFor } from "../providers/pricing.js";
import type { Config } from "../config/store.js";
import { createMetrics } from "../metrics/collector.js";
import { runPipeline } from "./run.js";

const TINY_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

function product(id: string, category = "Sofas"): Product {
  return {
    _id: id,
    title: `Product ${id}`,
    description: "desc",
    category,
    type: "Sectional",
    price: 100,
    width: 1,
    height: 1,
    depth: 1,
  };
}

const ZERO_USAGE: ProviderUsage = {
  promptTokens: 0,
  completionTokens: 0,
  model: "gpt-4o-mini",
};

function makeProvider(
  extracted: ExtractedAttributes,
  usage: ProviderUsage = ZERO_USAGE,
): Provider {
  return {
    name: "fake",
    extractFromImage: vi.fn(async () => ({ extracted, usage })),
  };
}

const baseConfig: Config = {
  topK: 20,
  rerank: false,
  provider: "openai",
  visionModel: "gpt-4o-mini",
};

describe("runPipeline", () => {
  it("returns ranked products with correct meta on the success path", async () => {
    const extracted: ExtractedAttributes = {
      category: "Sofas",
      description: "modern leather sectional",
    };
    const provider = makeProvider(extracted);
    const fixture = [product("a"), product("b")];
    const searchCatalog = vi.fn(async () => fixture);

    const response = await runPipeline(
      {
        image: TINY_PNG,
        mimeType: "image/png",
        prompt: "rustic",
        apiKey: "sk-test",
      },
      {
        provider,
        searchCatalog,
        getConfig: () => ({ ...baseConfig }),
        createMetrics,
      },
    );

    expect(response.results).toEqual(fixture);
    expect(response.meta.extracted).toEqual(extracted);
    expect(response.meta.stagesRan).toEqual([
      "visionExtract",
      "queryBuild",
      "catalogSearch",
    ]);
    expect(response.meta.lowConfidence).toBeUndefined();
    expect(typeof response.meta.latencyMs).toBe("number");

    expect(searchCatalog).toHaveBeenCalledWith(
      "modern leather sectional rustic",
      { category: "Sofas" },
      20,
    );
  });

  it("aggregates provider tokens, computes costUsd, and exposes top-3 raw results in meta", async () => {
    const extracted: ExtractedAttributes = {
      category: "Sofas",
      description: "modern leather sectional",
    };
    const usage: ProviderUsage = {
      promptTokens: 100,
      completionTokens: 50,
      model: "gpt-4o-mini",
    };
    const provider = makeProvider(extracted, usage);
    const fixture = [
      product("a"),
      product("b"),
      product("c"),
      product("d"),
      product("e"),
    ];
    const searchCatalog = vi.fn(async () => fixture);

    const response = await runPipeline(
      { image: TINY_PNG, mimeType: "image/png", apiKey: "k" },
      {
        provider,
        searchCatalog,
        getConfig: () => ({ ...baseConfig }),
        createMetrics,
      },
    );

    expect(response.meta.tokens).toEqual({
      prompt: 100,
      completion: 50,
      total: 150,
    });
    expect(response.meta.costUsd).toBe(priceFor("gpt-4o-mini", 100, 50));

    expect(response.meta.topResults).toHaveLength(3);
    expect(response.meta.topResults.map((r) => r.productId)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(response.meta.topResults[0].score).toBeGreaterThan(
      response.meta.topResults[1].score,
    );
    expect(response.meta.topResults[1].score).toBeGreaterThan(
      response.meta.topResults[2].score,
    );
  });

  it("populates a zero token/cost meta when usage is zero and no rerank ran", async () => {
    const provider = makeProvider({ description: "x" });
    const searchCatalog = vi.fn(async () => [] as Product[]);

    const response = await runPipeline(
      { image: TINY_PNG, mimeType: "image/png", apiKey: "k" },
      {
        provider,
        searchCatalog,
        getConfig: () => ({ ...baseConfig }),
        createMetrics,
      },
    );

    expect(response.meta.tokens).toEqual({ prompt: 0, completion: 0, total: 0 });
    expect(response.meta.costUsd).toBe(0);
    expect(response.meta.topResults).toEqual([]);
  });

  it("surfaces ProviderError thrown by the vision stage", async () => {
    const provider: Provider = {
      name: "fake",
      extractFromImage: vi.fn(async () => {
        throw new ProviderError({
          code: "UNRECOGNIZED_IMAGE",
          message: "We couldn't recognize this image.",
        });
      }),
    };
    const searchCatalog = vi.fn(async () => [] as Product[]);

    await expect(
      runPipeline(
        { image: TINY_PNG, mimeType: "image/png", apiKey: "k" },
        {
          provider,
          searchCatalog,
          getConfig: () => ({ ...baseConfig }),
          createMetrics,
        },
      ),
    ).rejects.toMatchObject({
      name: "ProviderError",
      code: "UNRECOGNIZED_IMAGE",
    });

    expect(searchCatalog).not.toHaveBeenCalled();
  });

  it("returns empty results with meta.lowConfidence=true when the catalog returns nothing", async () => {
    const extracted: ExtractedAttributes = { description: "abstract painting" };
    const provider = makeProvider(extracted);
    const searchCatalog = vi.fn(async () => [] as Product[]);

    const response = await runPipeline(
      { image: TINY_PNG, mimeType: "image/png", apiKey: "k" },
      {
        provider,
        searchCatalog,
        getConfig: () => ({ ...baseConfig }),
        createMetrics,
      },
    );

    expect(response.results).toEqual([]);
    expect(response.meta.lowConfidence).toBe(true);
    expect(response.meta.stagesRan).toEqual([
      "visionExtract",
      "queryBuild",
      "catalogSearch",
    ]);
  });

  it("skips the rerank stage when config.rerank is false", async () => {
    const provider = makeProvider({ description: "x" });
    const searchCatalog = vi.fn(async () => [product("a")]);

    const response = await runPipeline(
      { image: TINY_PNG, mimeType: "image/png", apiKey: "k" },
      {
        provider,
        searchCatalog,
        getConfig: () => ({ ...baseConfig, rerank: false }),
        createMetrics,
      },
    );

    expect(response.meta.stagesRan).not.toContain("rerank");
  });

  it("runs the rerank stage when config.rerank is true", async () => {
    const provider = makeProvider({ description: "x" });
    const fixture = [product("a"), product("b")];
    const searchCatalog = vi.fn(async () => fixture);

    const response = await runPipeline(
      { image: TINY_PNG, mimeType: "image/png", apiKey: "k" },
      {
        provider,
        searchCatalog,
        getConfig: () => ({ ...baseConfig, rerank: true }),
        createMetrics,
      },
    );

    expect(response.meta.stagesRan).toContain("rerank");
    // Stub passthrough preserves order today.
    expect(response.results).toEqual(fixture);
  });

  it("uses the provider and visionModel from injected config", async () => {
    const provider = makeProvider({ description: "x" });
    const searchCatalog = vi.fn(async () => [product("a")]);

    await runPipeline(
      { image: TINY_PNG, mimeType: "image/png", apiKey: "k" },
      {
        provider,
        searchCatalog,
        getConfig: () => ({ ...baseConfig, visionModel: "gpt-4o" }),
        createMetrics,
      },
    );

    const arg = (provider.extractFromImage as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(arg.model).toBe("gpt-4o");
    expect(arg.apiKey).toBe("k");
  });
});
