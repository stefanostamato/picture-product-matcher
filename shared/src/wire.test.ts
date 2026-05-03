import { describe, it, expect, expectTypeOf } from "vitest";
import type { Product } from "./catalog";
import type {
  ApiError,
  ExtractedAttributes,
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
      },
    };

    expect(response.results).toHaveLength(1);
    expect(response.meta.stagesRan).toContain("visionExtract");
    expect(response.meta.extracted.category).toBe("Benches");
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
