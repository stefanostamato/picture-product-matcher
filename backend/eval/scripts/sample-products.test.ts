import { describe, it, expect } from "vitest";

import { pickStratified, type RawProduct } from "./sample-products.js";

// Pure stratification logic — no Mongo, no FS, no network.
//
// Spec (from plans/eval-harness.md, Task E5):
//   For each category, pick `perCategory` products preferring different
//   `type` values. Fall back to same-type when a category has fewer types
//   than requested. Deterministic given a seed.

function p(
  productId: string,
  category: string,
  type: string,
  extras?: Partial<RawProduct>,
): RawProduct {
  return {
    productId,
    category,
    type,
    title: `${category} ${type} ${productId}`,
    description: `description-${productId}`,
    ...extras,
  };
}

describe("pickStratified", () => {
  it("returns perCategory items per category", () => {
    const products: RawProduct[] = [
      p("a1", "Sofas", "Sectional"),
      p("a2", "Sofas", "Loveseat"),
      p("a3", "Sofas", "Recliner"),
      p("b1", "Chairs", "Dining"),
      p("b2", "Chairs", "Lounge"),
      p("b3", "Chairs", "Office"),
    ];

    const out = pickStratified(products, 2, { seed: 42 });

    expect(out).toHaveLength(4);
    const sofas = out.filter((s) => s.category === "Sofas");
    const chairs = out.filter((s) => s.category === "Chairs");
    expect(sofas).toHaveLength(2);
    expect(chairs).toHaveLength(2);
  });

  it("prefers different type values within a category", () => {
    const products: RawProduct[] = [
      p("a1", "Sofas", "Sectional"),
      p("a2", "Sofas", "Sectional"),
      p("a3", "Sofas", "Sectional"),
      p("a4", "Sofas", "Loveseat"),
      p("a5", "Sofas", "Loveseat"),
    ];

    const out = pickStratified(products, 2, { seed: 1 });

    expect(out).toHaveLength(2);
    const types = new Set(out.map((s) => s.type));
    expect(types.size).toBe(2);
    expect(types.has("Sectional")).toBe(true);
    expect(types.has("Loveseat")).toBe(true);
  });

  it("falls back to same-type when a category has only one type", () => {
    const products: RawProduct[] = [
      p("a1", "Sofas", "Sectional"),
      p("a2", "Sofas", "Sectional"),
      p("a3", "Sofas", "Sectional"),
    ];

    const out = pickStratified(products, 2, { seed: 7 });

    expect(out).toHaveLength(2);
    expect(out.every((s) => s.category === "Sofas")).toBe(true);
    expect(out.every((s) => s.type === "Sectional")).toBe(true);
    const ids = new Set(out.map((s) => s.productId));
    expect(ids.size).toBe(2);
  });

  it("is deterministic given the same seed", () => {
    const products: RawProduct[] = [
      p("a1", "Sofas", "Sectional"),
      p("a2", "Sofas", "Sectional"),
      p("a3", "Sofas", "Loveseat"),
      p("a4", "Sofas", "Loveseat"),
      p("b1", "Chairs", "Dining"),
      p("b2", "Chairs", "Lounge"),
      p("b3", "Chairs", "Office"),
    ];

    const a = pickStratified(products, 2, { seed: 12345 });
    const b = pickStratified(products, 2, { seed: 12345 });

    expect(a).toEqual(b);
  });

  it("returns whatever is available when a category has fewer than perCategory products", () => {
    const products: RawProduct[] = [
      p("a1", "Sofas", "Sectional"),
      p("b1", "Chairs", "Dining"),
      p("b2", "Chairs", "Lounge"),
    ];

    const out = pickStratified(products, 2, { seed: 0 });

    const sofas = out.filter((s) => s.category === "Sofas");
    const chairs = out.filter((s) => s.category === "Chairs");
    expect(sofas).toHaveLength(1);
    expect(chairs).toHaveLength(2);
  });

  it("preserves the productId/category/type/title/description fields", () => {
    const products: RawProduct[] = [
      p("a1", "Sofas", "Sectional", { description: "blue velvet" }),
    ];

    const out = pickStratified(products, 1, { seed: 0 });

    expect(out[0]).toEqual({
      productId: "a1",
      category: "Sofas",
      type: "Sectional",
      title: "Sofas Sectional a1",
      description: "blue velvet",
    });
  });
});
