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
  it("forwards query, filters, and limit to searchCatalog and returns its result", async () => {
    const fixture: Product[] = [product("a"), product("b")];
    const searchCatalog = vi.fn(async () => fixture);

    const result = await catalogSearch(
      { query: "leather sofa", filters: { category: "Sofas" } },
      { searchCatalog, topK: 5 },
    );

    expect(result).toBe(fixture);
    expect(searchCatalog).toHaveBeenCalledWith(
      "leather sofa",
      { category: "Sofas" },
      5,
    );
  });

  it("returns an empty array when the catalog has no matches", async () => {
    const searchCatalog = vi.fn(async () => [] as Product[]);

    const result = await catalogSearch(
      { query: "x", filters: {} },
      { searchCatalog, topK: 20 },
    );

    expect(result).toEqual([]);
  });
});
