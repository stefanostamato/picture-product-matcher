import { describe, it, expect } from "vitest";
import { queryBuild } from "./queryBuild.js";

describe("queryBuild stage", () => {
  it("uses the extracted description as the query when no prompt is supplied", () => {
    const result = queryBuild({ description: "modern leather sectional sofa" });
    expect(result.query).toBe("modern leather sectional sofa");
    expect(result.filters).toEqual({});
  });

  it("concatenates description and the user prompt", () => {
    const result = queryBuild(
      { description: "wooden dining table" },
      "I want something rustic",
    );
    expect(result.query).toBe("wooden dining table I want something rustic");
  });

  it("collapses runs of whitespace in the combined query", () => {
    const result = queryBuild(
      { description: "wooden   dining\ttable" },
      "  rustic   feel  ",
    );
    expect(result.query).toBe("wooden dining table rustic feel");
  });

  it("sets filters.category only when extracted.category is truthy and non-empty", () => {
    expect(queryBuild({ description: "x", category: "Sofas" }).filters).toEqual({
      category: "Sofas",
    });
    expect(queryBuild({ description: "x", category: "" }).filters).toEqual({});
    expect(queryBuild({ description: "x" }).filters).toEqual({});
  });

  it("snaps a case-only mismatch to the canonical capitalization", () => {
    expect(queryBuild({ description: "x", category: "sofas" }).filters).toEqual({
      category: "Sofas",
    });
    expect(queryBuild({ description: "x", category: "  CHAIRS  " }).filters).toEqual({
      category: "Chairs",
    });
  });

  it("drops the category filter when the value is not in the closed list", () => {
    expect(queryBuild({ description: "x", category: "sofa" }).filters).toEqual({});
    expect(queryBuild({ description: "x", category: "couch" }).filters).toEqual({});
    expect(queryBuild({ description: "x", category: "barstool" }).filters).toEqual({});
  });

  it("ignores undefined / empty user prompt", () => {
    expect(queryBuild({ description: "wood chair" }, undefined).query).toBe(
      "wood chair",
    );
    expect(queryBuild({ description: "wood chair" }, "").query).toBe("wood chair");
    expect(queryBuild({ description: "wood chair" }, "   ").query).toBe(
      "wood chair",
    );
  });
});
