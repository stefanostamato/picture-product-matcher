import { describe, expect, it } from "vitest";
import type { ExtractedAttributes, SearchResponse } from "shared/wire";
import type { Product } from "shared/catalog";
import {
  aggregate,
  aggregateByCategory,
  attributeOverlap,
  categoryHit,
  recallAtK,
  reciprocalRank,
  typeHit,
} from "./scorer";
import type { EvalRow, GoldItem } from "./types";

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

const gold = (overrides: Partial<GoldItem> = {}): GoldItem => ({
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

const response = (
  results: Product[],
  metaOverrides: Partial<SearchResponse["meta"]> = {},
): SearchResponse => ({
  results,
  meta: {
    latencyMs: 100,
    stagesRan: ["visionExtract", "queryBuild", "catalogSearch"],
    extracted: { description: "stub" },
    tokens: { prompt: 0, completion: 0, total: 0 },
    costUsd: 0,
    topResults: [],
    ...metaOverrides,
  },
});

describe("recallAtK", () => {
  const results = [product("a"), product("b"), product("c"), product("d"), product("e")];

  it("returns 1 when the target is at rank 1 within K", () => {
    expect(recallAtK("a", results, 1)).toBe(1);
    expect(recallAtK("a", results, 5)).toBe(1);
  });

  it("returns 1 when the target is at rank K", () => {
    expect(recallAtK("c", results, 3)).toBe(1);
  });

  it("returns 0 when the target is at rank K+1", () => {
    expect(recallAtK("d", results, 3)).toBe(0);
  });

  it("returns 0 when the target is absent", () => {
    expect(recallAtK("zzz", results, 5)).toBe(0);
  });

  it("returns 0 with an empty result list", () => {
    expect(recallAtK("a", [], 5)).toBe(0);
  });
});

describe("reciprocalRank", () => {
  const results = [product("a"), product("b"), product("c"), product("d")];

  it("returns 1 when the target is at rank 1", () => {
    expect(reciprocalRank("a", results)).toBe(1);
  });

  it("returns 1/K when the target is at rank K", () => {
    expect(reciprocalRank("c", results)).toBeCloseTo(1 / 3, 10);
    expect(reciprocalRank("d", results)).toBeCloseTo(1 / 4, 10);
  });

  it("returns 0 when the target is absent", () => {
    expect(reciprocalRank("zzz", results)).toBe(0);
  });

  it("returns 0 with an empty result list", () => {
    expect(reciprocalRank("a", [])).toBe(0);
  });
});

describe("categoryHit / typeHit", () => {
  it("matches case-insensitively when category aligns", () => {
    const extracted: ExtractedAttributes = { category: "sofas", description: "x" };
    expect(categoryHit(extracted, gold({ category: "Sofas" }))).toBe(true);
  });

  it("returns false when extracted category is missing", () => {
    const extracted: ExtractedAttributes = { description: "x" };
    expect(categoryHit(extracted, gold())).toBe(false);
  });

  it("returns false when categories differ", () => {
    const extracted: ExtractedAttributes = { category: "Chairs", description: "x" };
    expect(categoryHit(extracted, gold({ category: "Sofas" }))).toBe(false);
  });

  it("matches type case-insensitively", () => {
    const extracted: ExtractedAttributes = { type: "sectional", description: "x" };
    expect(typeHit(extracted, gold({ type: "Sectional" }))).toBe(true);
  });

  it("returns false when extracted type is missing", () => {
    const extracted: ExtractedAttributes = { description: "x" };
    expect(typeHit(extracted, gold())).toBe(false);
  });
});

describe("attributeOverlap", () => {
  it("returns 1 on a full match across color/material/style", () => {
    const extracted: ExtractedAttributes = {
      color: "grey",
      material: "velvet",
      style: "modern",
      description: "x",
    };
    const g = gold({ color: ["grey"], material: ["velvet"], style: ["modern"] });
    expect(attributeOverlap(extracted, g)).toBe(1);
  });

  it("returns 0 with no overlap", () => {
    const extracted: ExtractedAttributes = {
      color: "blue",
      material: "leather",
      style: "rustic",
      description: "x",
    };
    const g = gold({ color: ["grey"], material: ["velvet"], style: ["modern"] });
    expect(attributeOverlap(extracted, g)).toBe(0);
  });

  it("returns 0 when both sides are empty", () => {
    const extracted: ExtractedAttributes = { description: "x" };
    const g = gold({ color: [], material: [], style: [] });
    expect(attributeOverlap(extracted, g)).toBe(0);
  });

  it("returns Jaccard for a partial match", () => {
    // extracted: {grey, velvet, modern}; gold: {grey, leather, modern, mid-century}
    // intersection = {grey, modern} = 2; union = 5; jaccard = 0.4
    const extracted: ExtractedAttributes = {
      color: "grey",
      material: "velvet",
      style: "modern",
      description: "x",
    };
    const g = gold({
      color: ["grey"],
      material: ["leather"],
      style: ["modern", "mid-century"],
    });
    expect(attributeOverlap(extracted, g)).toBeCloseTo(2 / 5, 10);
  });

  it("is case-insensitive", () => {
    const extracted: ExtractedAttributes = {
      color: "GREY",
      material: "Velvet",
      style: "Modern",
      description: "x",
    };
    const g = gold({ color: ["grey"], material: ["velvet"], style: ["modern"] });
    expect(attributeOverlap(extracted, g)).toBe(1);
  });
});

describe("aggregate", () => {
  // Build a fixed 5-row fixture with hand-computed expectations.
  const buildRows = (): EvalRow[] => {
    const make = (
      idx: number,
      targetRank: number | null,
      catHit: boolean,
      tHit: boolean,
      attrOverlap: number,
      latencyMs: number,
      promptTokens: number,
      completionTokens: number,
      costUsd: number,
    ): EvalRow => {
      const targetId = `gold-${idx}`;
      // Build results so that the target is at `targetRank` (1-based) or absent.
      const results: Product[] = [];
      for (let r = 1; r <= 5; r++) {
        results.push(product(targetRank === r ? targetId : `other-${idx}-${r}`));
      }
      const goldItem = gold({ productId: targetId, category: `Cat${idx}` });
      return {
        goldItem,
        response: response(results, {
          latencyMs,
          tokens: {
            prompt: promptTokens,
            completion: completionTokens,
            total: promptTokens + completionTokens,
          },
          costUsd,
        }),
        scores: {
          recallAt1: recallAtK(targetId, results, 1),
          recallAt5: recallAtK(targetId, results, 5),
          recallAt20: recallAtK(targetId, results, 20),
          reciprocalRank: reciprocalRank(targetId, results),
          categoryHit: catHit,
          typeHit: tHit,
          attributeOverlap: attrOverlap,
        },
      };
    };

    return [
      // rank 1, full hit
      make(1, 1, true, true, 1.0, 100, 100, 50, 0.0001),
      // rank 3 (within 5, not within 1)
      make(2, 3, true, false, 0.5, 200, 120, 60, 0.0002),
      // rank 5 (within 5)
      make(3, 5, false, false, 0.0, 300, 80, 40, 0.0003),
      // absent
      make(4, null, false, false, 0.25, 400, 200, 100, 0.0004),
      // rank 2
      make(5, 2, true, true, 0.75, 500, 110, 55, 0.0005),
    ];
  };

  it("computes recall@K, MRR, hits, attribute mean, p50/p95, totals", () => {
    const rows = buildRows();
    const overall = aggregate(rows);

    // recall@1: only row 1 has rank 1 → 1/5 = 0.2
    expect(overall.recallAt1).toBeCloseTo(1 / 5, 10);
    // recall@5: rows 1,2,3,5 (4 of 5) → 0.8
    expect(overall.recallAt5).toBeCloseTo(4 / 5, 10);
    // recall@20: same 4 of 5 (we have 5-result lists; row 4 absent) → 0.8
    expect(overall.recallAt20).toBeCloseTo(4 / 5, 10);
    // MRR: (1 + 1/3 + 1/5 + 0 + 1/2) / 5
    expect(overall.mrr).toBeCloseTo((1 + 1 / 3 + 1 / 5 + 0 + 1 / 2) / 5, 10);
    // category hit rate: 3/5 = 0.6
    expect(overall.categoryHitRate).toBeCloseTo(3 / 5, 10);
    // type hit rate: 2/5 = 0.4
    expect(overall.typeHitRate).toBeCloseTo(2 / 5, 10);
    // mean attribute overlap: (1 + 0.5 + 0 + 0.25 + 0.75) / 5 = 0.5
    expect(overall.meanAttributeOverlap).toBeCloseTo(0.5, 10);

    // n
    expect(overall.n).toBe(5);

    // total tokens: 150 + 180 + 120 + 300 + 165 = 915
    expect(overall.totalTokens).toBe(915);
    // total cost: sum of fixture costs
    expect(overall.totalCostUsd).toBeCloseTo(0.0001 + 0.0002 + 0.0003 + 0.0004 + 0.0005, 10);

    // failure modes:
    // - missingTarget: row 4 (absent within results) → 1
    // - categoryMiss: rows 3, 4 → 2
    // - typeMiss: rows 2, 3, 4 → 3
    expect(overall.failures.missingTarget).toBe(1);
    expect(overall.failures.categoryMiss).toBe(2);
    expect(overall.failures.typeMiss).toBe(3);
  });

  it("computes p50/p95 latency for n=5 to expected elements", () => {
    const rows = buildRows();
    const overall = aggregate(rows);
    // latencies sorted: [100, 200, 300, 400, 500]
    // p50: nearest-rank with n=5 → ceil(0.5 * 5) = 3 → index 2 → 300
    // p95: ceil(0.95 * 5) = 5 → index 4 → 500
    expect(overall.p50LatencyMs).toBe(300);
    expect(overall.p95LatencyMs).toBe(500);
  });

  it("returns zeroed metrics for an empty row list", () => {
    const overall = aggregate([]);
    expect(overall.n).toBe(0);
    expect(overall.recallAt1).toBe(0);
    expect(overall.recallAt5).toBe(0);
    expect(overall.recallAt20).toBe(0);
    expect(overall.mrr).toBe(0);
    expect(overall.categoryHitRate).toBe(0);
    expect(overall.typeHitRate).toBe(0);
    expect(overall.meanAttributeOverlap).toBe(0);
    expect(overall.p50LatencyMs).toBe(0);
    expect(overall.p95LatencyMs).toBe(0);
    expect(overall.totalTokens).toBe(0);
    expect(overall.totalCostUsd).toBe(0);
    expect(overall.failures.missingTarget).toBe(0);
    expect(overall.failures.categoryMiss).toBe(0);
    expect(overall.failures.typeMiss).toBe(0);
  });
});

describe("aggregateByCategory", () => {
  it("buckets rows by goldItem.category and reports per-bucket overall metrics", () => {
    const mkRow = (id: string, category: string, results: Product[]): EvalRow => {
      const goldItem = gold({ productId: id, category });
      return {
        goldItem,
        response: response(results),
        scores: {
          recallAt1: recallAtK(id, results, 1),
          recallAt5: recallAtK(id, results, 5),
          recallAt20: recallAtK(id, results, 20),
          reciprocalRank: reciprocalRank(id, results),
          categoryHit: true,
          typeHit: true,
          attributeOverlap: 1,
        },
      };
    };

    const rows = [
      // Sofas: target hits at rank 1
      mkRow("s1", "Sofas", [product("s1"), product("x")]),
      // Sofas: target absent
      mkRow("s2", "Sofas", [product("y"), product("z")]),
      // Chairs: target at rank 2
      mkRow("c1", "Chairs", [product("a"), product("c1")]),
    ];

    const byCategory = aggregateByCategory(rows);
    expect(Object.keys(byCategory).sort()).toEqual(["Chairs", "Sofas"]);

    expect(byCategory.Sofas.n).toBe(2);
    expect(byCategory.Sofas.recallAt1).toBeCloseTo(1 / 2, 10);
    expect(byCategory.Sofas.recallAt5).toBeCloseTo(1 / 2, 10);

    expect(byCategory.Chairs.n).toBe(1);
    expect(byCategory.Chairs.recallAt1).toBe(0);
    expect(byCategory.Chairs.recallAt5).toBe(1);
    expect(byCategory.Chairs.mrr).toBeCloseTo(1 / 2, 10);
  });
});
