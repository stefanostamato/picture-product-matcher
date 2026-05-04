import { describe, it, expect } from "vitest";
import { priceFor, priceForImage, UnknownModelError } from "./pricing.js";

describe("priceFor", () => {
  it("computes USD cost for gpt-4o-mini at the published rate", () => {
    // gpt-4o-mini: $0.15 / 1M input, $0.60 / 1M output
    // 1000 prompt + 500 completion = 0.15 * 1000/1e6 + 0.60 * 500/1e6
    //   = 0.00015 + 0.0003 = 0.00045
    expect(priceFor("gpt-4o-mini", 1000, 500)).toBeCloseTo(0.00045, 6);
  });

  it("computes USD cost for gpt-4o at the published rate", () => {
    // gpt-4o: $2.50 / 1M input, $10.00 / 1M output
    // 1000 prompt + 500 completion = 2.50 * 1000/1e6 + 10.00 * 500/1e6
    //   = 0.0025 + 0.005 = 0.0075
    expect(priceFor("gpt-4o", 1000, 500)).toBeCloseTo(0.0075, 6);
  });

  it("returns 0 when both token counts are zero", () => {
    expect(priceFor("gpt-4o-mini", 0, 0)).toBe(0);
  });

  it("throws UnknownModelError for an unknown model identifier", () => {
    expect(() => priceFor("not-a-real-model", 100, 50)).toThrow(
      UnknownModelError,
    );
  });

  it("UnknownModelError message names the offending model", () => {
    try {
      priceFor("nope-1", 1, 1);
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(UnknownModelError);
      expect((err as Error).message).toContain("nope-1");
    }
  });
});

describe("priceForImage", () => {
  it("returns flat per-image rate for gpt-image-1", () => {
    // gpt-image-1 standard 1024x1024 ≈ $0.04 per image
    expect(priceForImage("gpt-image-1", 1)).toBeCloseTo(0.04, 6);
  });

  it("scales linearly with image count", () => {
    expect(priceForImage("gpt-image-1", 5)).toBeCloseTo(0.2, 6);
  });

  it("returns 0 for zero images", () => {
    expect(priceForImage("gpt-image-1", 0)).toBe(0);
  });

  it("throws UnknownModelError for an unknown image model", () => {
    expect(() => priceForImage("dall-e-fake", 1)).toThrow(UnknownModelError);
  });
});
