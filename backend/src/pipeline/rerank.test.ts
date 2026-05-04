import { describe, it, expect, vi } from "vitest";
import type { Product } from "shared/catalog";
import type { Provider } from "../providers/index.js";
import type {
  ProviderUsage,
  RerankWithImageInput,
  RerankWithImageResult,
} from "../providers/types.js";
import { rerank, type RerankDeps } from "./rerank.js";

const TINY_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

function product(id: string): Product {
  return {
    _id: id,
    title: `Title ${id}`,
    description: `Description ${id}`,
    category: "Sofas",
    type: "Sectional",
    price: 100,
    width: 1,
    height: 1,
    depth: 1,
  };
}

const RERANK_USAGE: ProviderUsage = {
  promptTokens: 30,
  completionTokens: 10,
  model: "gpt-4o-mini",
};

function makeProvider(
  rerankImpl: (
    input: RerankWithImageInput,
  ) => Promise<RerankWithImageResult>,
): Provider {
  return {
    name: "fake",
    extractFromImage: vi.fn(),
    rerankWithImage: vi.fn(rerankImpl),
  };
}

function makeDeps(provider: Provider, overrides: Partial<RerankDeps> = {}): RerankDeps {
  return {
    enabled: true,
    provider,
    apiKey: "sk-test",
    image: TINY_PNG,
    mimeType: "image/png",
    model: "gpt-4o-mini",
    systemPrompt: "rerank-system-prompt",
    topN: 10,
    ...overrides,
  };
}

describe("rerank", () => {
  it("returns input unchanged and skips the provider call when disabled", async () => {
    const provider = makeProvider(async () => ({
      orderedIds: [],
      usage: RERANK_USAGE,
    }));
    const fixture = [product("a"), product("b"), product("c")];

    const result = await rerank(fixture, { description: "x" }, makeDeps(provider, { enabled: false }));

    expect(result.products).toEqual(fixture);
    expect(result.usage).toBeUndefined();
    expect(provider.rerankWithImage).not.toHaveBeenCalled();
  });

  it("returns input unchanged when there is only one candidate (nothing to reorder)", async () => {
    const provider = makeProvider(async () => ({
      orderedIds: ["a"],
      usage: RERANK_USAGE,
    }));
    const fixture = [product("a")];

    const result = await rerank(fixture, { description: "x" }, makeDeps(provider));

    expect(result.products).toEqual(fixture);
    expect(result.usage).toBeUndefined();
    expect(provider.rerankWithImage).not.toHaveBeenCalled();
  });

  it("reorders the products to match orderedIds and surfaces usage", async () => {
    const provider = makeProvider(async () => ({
      orderedIds: ["c", "a", "b"],
      usage: RERANK_USAGE,
    }));
    const fixture = [product("a"), product("b"), product("c")];

    const result = await rerank(fixture, { description: "x" }, makeDeps(provider));

    expect(result.products.map((p) => p._id)).toEqual(["c", "a", "b"]);
    expect(result.usage).toEqual(RERANK_USAGE);

    const call = (provider.rerankWithImage as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(call.candidates).toEqual([
      { id: "a", title: "Title a", description: "Description a" },
      { id: "b", title: "Title b", description: "Description b" },
      { id: "c", title: "Title c", description: "Description c" },
    ]);
    expect(call.image).toBe(TINY_PNG);
    expect(call.mimeType).toBe("image/png");
    expect(call.model).toBe("gpt-4o-mini");
    expect(call.systemPrompt).toBe("rerank-system-prompt");
    expect(call.apiKey).toBe("sk-test");
  });

  it("only reorders the first topN products and preserves the tail verbatim", async () => {
    const provider = makeProvider(async () => ({
      orderedIds: ["b", "a"],
      usage: RERANK_USAGE,
    }));
    const fixture = [
      product("a"),
      product("b"),
      product("c"),
      product("d"),
      product("e"),
    ];

    const result = await rerank(
      fixture,
      { description: "x" },
      makeDeps(provider, { topN: 2 }),
    );

    expect(result.products.map((p) => p._id)).toEqual(["b", "a", "c", "d", "e"]);
    expect(result.products.slice(2)).toEqual(fixture.slice(2));

    const call = (provider.rerankWithImage as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(call.candidates.map((c: { id: string }) => c.id)).toEqual(["a", "b"]);
  });

  it("falls back to the input order when orderedIds has an extra id", async () => {
    const provider = makeProvider(async () => ({
      orderedIds: ["a", "b", "c", "d"],
      usage: RERANK_USAGE,
    }));
    const fixture = [product("a"), product("b"), product("c")];

    const result = await rerank(fixture, { description: "x" }, makeDeps(provider));

    expect(result.products).toEqual(fixture);
    expect(result.usage).toEqual(RERANK_USAGE);
  });

  it("falls back to the input order when orderedIds is missing an id", async () => {
    const provider = makeProvider(async () => ({
      orderedIds: ["a", "b"],
      usage: RERANK_USAGE,
    }));
    const fixture = [product("a"), product("b"), product("c")];

    const result = await rerank(fixture, { description: "x" }, makeDeps(provider));

    expect(result.products).toEqual(fixture);
    expect(result.usage).toEqual(RERANK_USAGE);
  });

  it("falls back to the input order when orderedIds contains duplicates", async () => {
    const provider = makeProvider(async () => ({
      orderedIds: ["a", "a", "b"],
      usage: RERANK_USAGE,
    }));
    const fixture = [product("a"), product("b"), product("c")];

    const result = await rerank(fixture, { description: "x" }, makeDeps(provider));

    expect(result.products).toEqual(fixture);
    expect(result.usage).toEqual(RERANK_USAGE);
  });

  it("propagates errors thrown by the provider", async () => {
    const provider = makeProvider(async () => {
      throw new Error("provider boom");
    });
    const fixture = [product("a"), product("b")];

    await expect(
      rerank(fixture, { description: "x" }, makeDeps(provider)),
    ).rejects.toThrow("provider boom");
  });
});
