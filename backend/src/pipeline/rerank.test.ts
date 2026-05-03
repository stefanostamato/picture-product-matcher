import { describe, it, expect } from "vitest";
import type { Product } from "shared/catalog";
import { rerank } from "./rerank.js";

const fixture: Product[] = [
  {
    _id: "a",
    title: "A",
    description: "desc",
    category: "Sofas",
    type: "Sectional",
    price: 1,
    width: 1,
    height: 1,
    depth: 1,
  },
  {
    _id: "b",
    title: "B",
    description: "desc",
    category: "Sofas",
    type: "Sectional",
    price: 2,
    width: 1,
    height: 1,
    depth: 1,
  },
];

describe("rerank stub", () => {
  it("passes the input through unchanged when disabled", async () => {
    const out = await rerank(fixture, { description: "x" }, { enabled: false });
    expect(out).toEqual(fixture);
  });

  it("passes the input through unchanged when enabled (stub behaviour)", async () => {
    const out = await rerank(fixture, { description: "x" }, { enabled: true });
    expect(out).toEqual(fixture);
  });
});
