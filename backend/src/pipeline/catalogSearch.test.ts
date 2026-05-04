import { describe, it, expect, vi } from "vitest";
import type { Product } from "shared/catalog";
import { catalogSearch } from "./catalogSearch.js";

const product = (id: string): Product => ({
  _id: id,
  title: `Product ${id}`,
  description: "desc",
  category: "Sofas",
  type: "Sectional",
  price: 100,
  width: 1,
  height: 1,
  depth: 1,
});

describe("catalogSearch stage", () => {
  it("forwards query, filters, and limit to searchCatalog and returns its products plus top-3 raw scores", async () => {
    const fixture: Product[] = [
      product("a"),
      product("b"),
      product("c"),
      product("d"),
      product("e"),
    ];
    const searchCatalog = vi.fn(async () => fixture);

    const result = await catalogSearch(
      { query: "leather sofa", filters: { category: "Sofas" } },
      { searchCatalog, topK: 5 },
    );

    expect(result.products).toEqual(fixture);
    expect(searchCatalog).toHaveBeenCalledWith(
      "leather sofa",
      { category: "Sofas" },
      5,
    );

    expect(result.topRaw).toHaveLength(3);
    expect(result.topRaw.map((r) => r.productId)).toEqual(["a", "b", "c"]);
    // Scores must be in descending order so the diag panel can render them as-is.
    expect(result.topRaw[0].score).toBeGreaterThan(result.topRaw[1].score);
    expect(result.topRaw[1].score).toBeGreaterThan(result.topRaw[2].score);
  });

  it("returns empty products and empty topRaw when the catalog has no matches", async () => {
    const searchCatalog = vi.fn(async () => [] as Product[]);

    const result = await catalogSearch(
      { query: "x", filters: {} },
      { searchCatalog, topK: 20 },
    );

    expect(result.products).toEqual([]);
    expect(result.topRaw).toEqual([]);
  });

  it("clips topRaw to the available results when fewer than 3 are returned", async () => {
    const fixture: Product[] = [product("a"), product("b")];
    const searchCatalog = vi.fn(async () => fixture);

    const result = await catalogSearch(
      { query: "x", filters: {} },
      { searchCatalog, topK: 10 },
    );

    expect(result.products).toEqual(fixture);
    expect(result.topRaw).toHaveLength(2);
    expect(result.topRaw.map((r) => r.productId)).toEqual(["a", "b"]);
    expect(result.topRaw[0].score).toBeGreaterThan(result.topRaw[1].score);
  });
});
