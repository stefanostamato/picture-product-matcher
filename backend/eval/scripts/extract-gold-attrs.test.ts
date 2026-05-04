import { describe, it, expect, vi, beforeEach } from "vitest";

// Hoisted SDK mock — same pattern as src/providers/openai.test.ts.
const { mockCreate, MockOpenAI } = vi.hoisted(() => {
  const mockCreate = vi.fn();
  class MockOpenAI {
    apiKey: string;
    chat = { completions: { create: mockCreate } };
    constructor(opts: { apiKey: string }) {
      this.apiKey = opts.apiKey;
    }
  }
  return { mockCreate, MockOpenAI };
});

vi.mock("openai", () => ({
  default: MockOpenAI,
  OpenAI: MockOpenAI,
}));

import { extractGoldAttrs, type GoldSampleInput } from "./extract-gold-attrs.js";

const SECRET_KEY = "sk-do-not-leak-attrs-test-9999";

const FIXTURE: GoldSampleInput = {
  productId: "abc123",
  category: "Sofas",
  type: "Sectional",
  title: "Modern Sectional",
  description: "Charcoal velvet sectional with chrome legs.",
};

function chatResponse(payload: unknown) {
  return {
    choices: [
      {
        message: {
          content: JSON.stringify(payload),
        },
      },
    ],
  };
}

describe("extractGoldAttrs", () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it("parses a schema-shaped response into a sidecar object", async () => {
    mockCreate.mockResolvedValueOnce(
      chatResponse({
        color: ["charcoal"],
        material: ["velvet", "chrome"],
        style: ["modern"],
      }),
    );

    const result = await extractGoldAttrs(FIXTURE, { apiKey: SECRET_KEY });

    expect(result).toEqual({
      productId: "abc123",
      category: "Sofas",
      type: "Sectional",
      title: "Modern Sectional",
      description: "Charcoal velvet sectional with chrome legs.",
      color: ["charcoal"],
      material: ["velvet", "chrome"],
      style: ["modern"],
    });
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("calls gpt-4o-mini at temperature 0", async () => {
    mockCreate.mockResolvedValueOnce(
      chatResponse({ color: [], material: [], style: [] }),
    );

    await extractGoldAttrs(FIXTURE, { apiKey: SECRET_KEY });

    const call = mockCreate.mock.calls[0][0];
    expect(call.model).toBe("gpt-4o-mini");
    expect(call.temperature).toBe(0);
  });

  it("never includes the API key in thrown errors", async () => {
    mockCreate.mockRejectedValueOnce(
      new Error(`upstream HTTP 401 referencing ${SECRET_KEY}`),
    );

    try {
      await extractGoldAttrs(FIXTURE, { apiKey: SECRET_KEY });
      throw new Error("should have thrown");
    } catch (err) {
      const e = err as Error;
      expect(e.message).not.toContain(SECRET_KEY);
      expect(JSON.stringify(e)).not.toContain(SECRET_KEY);
    }
  });

  it("throws when the model returns unparseable JSON", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: "not json" } }],
    });

    await expect(extractGoldAttrs(FIXTURE, { apiKey: SECRET_KEY })).rejects.toThrow();
  });

  it("throws when the model returns a response missing the required arrays", async () => {
    mockCreate.mockResolvedValueOnce(
      chatResponse({ color: ["red"], material: ["wood"] }),
    );

    await expect(extractGoldAttrs(FIXTURE, { apiKey: SECRET_KEY })).rejects.toThrow();
  });

  it("coerces missing-but-empty arrays — empty arrays are acceptable", async () => {
    mockCreate.mockResolvedValueOnce(
      chatResponse({ color: [], material: [], style: [] }),
    );

    const result = await extractGoldAttrs(FIXTURE, { apiKey: SECRET_KEY });

    expect(result.color).toEqual([]);
    expect(result.material).toEqual([]);
    expect(result.style).toEqual([]);
  });
});
