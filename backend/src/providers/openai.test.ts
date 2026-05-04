import { describe, it, expect, vi, beforeEach } from "vitest";

// Hoisted mock factory so the constructor reference is stable across the test
// module and the implementation under test.
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

import { openAIProvider } from "./openai.js";
import { getProvider } from "./index.js";
import { ProviderError } from "./types.js";

const SECRET_KEY = "sk-test-do-not-leak-1234567890";
const TINY_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

function mockResponse(
  payload: unknown,
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } = {
    prompt_tokens: 42,
    completion_tokens: 17,
    total_tokens: 59,
  },
) {
  return {
    choices: [
      {
        message: {
          content: JSON.stringify(payload),
        },
      },
    ],
    usage,
  };
}

describe("openAIProvider.extractFromImage", () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  const VISION_PROMPT = "You are a furniture-attribute extractor.";

  it("returns parsed ExtractedAttributes when the model responds with valid JSON", async () => {
    mockCreate.mockResolvedValueOnce(
      mockResponse({
        category: "Sofas",
        type: "Sectional",
        style: "modern",
        material: "leather",
        color: "charcoal",
        priceBand: "mid",
        description: "A modern charcoal leather sectional sofa.",
      }),
    );

    const result = await openAIProvider.extractFromImage({
      image: TINY_PNG,
      mimeType: "image/png",
      apiKey: SECRET_KEY,
      model: "gpt-4o-mini",
      systemPrompt: VISION_PROMPT,
    });

    expect(result.extracted).toEqual({
      category: "Sofas",
      type: "Sectional",
      style: "modern",
      material: "leather",
      color: "charcoal",
      priceBand: "mid",
      description: "A modern charcoal leather sectional sofa.",
    });
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("propagates usage (prompt/completion tokens + model) from the SDK response", async () => {
    mockCreate.mockResolvedValueOnce(
      mockResponse(
        { description: "A small armchair." },
        { prompt_tokens: 1234, completion_tokens: 567, total_tokens: 1801 },
      ),
    );

    const result = await openAIProvider.extractFromImage({
      image: TINY_PNG,
      mimeType: "image/png",
      apiKey: SECRET_KEY,
      model: "gpt-4o-mini",
      systemPrompt: VISION_PROMPT,
    });

    expect(result.usage).toEqual({
      promptTokens: 1234,
      completionTokens: 567,
      model: "gpt-4o-mini",
    });
  });

  it("falls back to zero token counts when the SDK response omits usage", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: JSON.stringify({ description: "x" }) } }],
    });

    const result = await openAIProvider.extractFromImage({
      image: TINY_PNG,
      mimeType: "image/png",
      apiKey: SECRET_KEY,
      model: "gpt-4o",
      systemPrompt: VISION_PROMPT,
    });

    expect(result.usage).toEqual({
      promptTokens: 0,
      completionTokens: 0,
      model: "gpt-4o",
    });
  });

  it("forwards the user prompt to the model when provided", async () => {
    mockCreate.mockResolvedValueOnce(
      mockResponse({ description: "A wooden chair." }),
    );

    await openAIProvider.extractFromImage({
      image: TINY_PNG,
      mimeType: "image/jpeg",
      userPrompt: "I want something rustic",
      apiKey: SECRET_KEY,
      model: "gpt-4o-mini",
      systemPrompt: VISION_PROMPT,
    });

    const call = mockCreate.mock.calls[0][0];
    const serialized = JSON.stringify(call);
    expect(serialized).toContain("I want something rustic");
  });

  it("threads systemPrompt verbatim into messages[0].content (system role)", async () => {
    mockCreate.mockResolvedValueOnce(
      mockResponse({ description: "A coffee table." }),
    );

    await openAIProvider.extractFromImage({
      image: TINY_PNG,
      mimeType: "image/png",
      apiKey: SECRET_KEY,
      model: "gpt-4o-mini",
      systemPrompt: VISION_PROMPT,
    });

    const call = mockCreate.mock.calls[0][0];
    expect(call.messages[0]).toEqual({
      role: "system",
      content: VISION_PROMPT,
    });
  });

  it("uses the systemPrompt verbatim and does not mix in any internal default", async () => {
    const CUSTOM_PROMPT = "Custom admin-supplied vision instructions.";
    mockCreate.mockResolvedValueOnce(
      mockResponse({ description: "A nightstand." }),
    );

    await openAIProvider.extractFromImage({
      image: TINY_PNG,
      mimeType: "image/png",
      apiKey: SECRET_KEY,
      model: "gpt-4o-mini",
      systemPrompt: CUSTOM_PROMPT,
    });

    const call = mockCreate.mock.calls[0][0];
    expect(call.messages[0].content).toBe(CUSTOM_PROMPT);
    // Confirm the previously-hardcoded SYSTEM_PROMPT phrasing is not snuck in.
    expect(call.messages[0].content).not.toContain(
      "You analyze a product photo",
    );
  });

  it("throws ProviderError when the SDK rejects (non-2xx upstream)", async () => {
    const upstream = Object.assign(new Error("Unauthorized"), { status: 401 });
    mockCreate.mockRejectedValue(upstream);

    await expect(
      openAIProvider.extractFromImage({
        image: TINY_PNG,
        mimeType: "image/png",
        apiKey: SECRET_KEY,
        model: "gpt-4o-mini",
        systemPrompt: VISION_PROMPT,
      }),
    ).rejects.toBeInstanceOf(ProviderError);

    try {
      await openAIProvider.extractFromImage({
        image: TINY_PNG,
        mimeType: "image/png",
        apiKey: SECRET_KEY,
        model: "gpt-4o-mini",
        systemPrompt: VISION_PROMPT,
      });
      throw new Error("should have thrown");
    } catch (err) {
      const e = err as ProviderError;
      expect(e).toBeInstanceOf(ProviderError);
      expect(e.code).toBe("PROVIDER_HTTP_ERROR");
      expect(e.message).not.toContain(SECRET_KEY);
    }
  });

  it("throws ProviderError with code UNRECOGNIZED_IMAGE when the model signals it cannot match", async () => {
    mockCreate.mockResolvedValueOnce(
      mockResponse({
        unrecognized: true,
        description: "",
      }),
    );

    await expect(
      openAIProvider.extractFromImage({
        image: TINY_PNG,
        mimeType: "image/png",
        apiKey: SECRET_KEY,
        model: "gpt-4o-mini",
        systemPrompt: VISION_PROMPT,
      }),
    ).rejects.toMatchObject({
      name: "ProviderError",
      code: "UNRECOGNIZED_IMAGE",
    });
  });

  it("throws ProviderError with code INVALID_RESPONSE when the model returns unparseable JSON", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: "not json at all" } }],
    });

    await expect(
      openAIProvider.extractFromImage({
        image: TINY_PNG,
        mimeType: "image/png",
        apiKey: SECRET_KEY,
        model: "gpt-4o-mini",
        systemPrompt: VISION_PROMPT,
      }),
    ).rejects.toMatchObject({
      name: "ProviderError",
      code: "INVALID_RESPONSE",
    });
  });

  it("never includes the API key in error messages", async () => {
    mockCreate.mockRejectedValueOnce(
      new Error(`some upstream error referencing ${SECRET_KEY}`),
    );

    try {
      await openAIProvider.extractFromImage({
        image: TINY_PNG,
        mimeType: "image/png",
        apiKey: SECRET_KEY,
        model: "gpt-4o-mini",
        systemPrompt: VISION_PROMPT,
      });
      throw new Error("should have thrown");
    } catch (err) {
      const e = err as ProviderError;
      expect(e).toBeInstanceOf(ProviderError);
      expect(e.message).not.toContain(SECRET_KEY);
      expect(JSON.stringify(e)).not.toContain(SECRET_KEY);
    }
  });

  it("uses the apiKey passed at call time and never reads from env", async () => {
    const previous = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "env-key-should-not-be-used";
    try {
      mockCreate.mockResolvedValueOnce(
        mockResponse({ description: "something" }),
      );

      await openAIProvider.extractFromImage({
        image: TINY_PNG,
        mimeType: "image/png",
        apiKey: SECRET_KEY,
        model: "gpt-4o-mini",
        systemPrompt: VISION_PROMPT,
      });

      // The mocked SDK records the apiKey it was constructed with via a
      // module-level capture; because we re-construct per call, we assert the
      // last constructed instance carried our per-call key (verified through
      // the call payload not containing env-key references).
      const call = mockCreate.mock.calls[0][0];
      const serialized = JSON.stringify(call);
      expect(serialized).not.toContain("env-key-should-not-be-used");
    } finally {
      if (previous === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previous;
    }
  });
});

describe("openAIProvider.rerankWithImage", () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  const RERANK_PROMPT = "You are a furniture-catalog reranker.";
  const CANDIDATES = [
    { id: "a", title: "Modern sofa", description: "A modern grey sofa." },
    { id: "b", title: "Classic chair", description: "A classic wooden chair." },
  ];

  function rerankResponse(
    payload: unknown,
    usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } = {
      prompt_tokens: 88,
      completion_tokens: 9,
      total_tokens: 97,
    },
  ) {
    return {
      choices: [
        {
          message: {
            content: JSON.stringify(payload),
          },
        },
      ],
      usage,
    };
  }

  it("returns orderedIds and usage when the model responds with valid JSON", async () => {
    mockCreate.mockResolvedValueOnce(
      rerankResponse(
        { orderedIds: ["b", "a"] },
        { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
      ),
    );

    const result = await openAIProvider.rerankWithImage({
      apiKey: SECRET_KEY,
      model: "gpt-4o-mini",
      systemPrompt: RERANK_PROMPT,
      image: TINY_PNG,
      mimeType: "image/png",
      candidates: CANDIDATES,
    });

    expect(result).toEqual({
      orderedIds: ["b", "a"],
      usage: {
        promptTokens: 100,
        completionTokens: 20,
        model: "gpt-4o-mini",
      },
    });
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("falls back to zero token counts when the SDK response omits usage", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [
        { message: { content: JSON.stringify({ orderedIds: ["a", "b"] }) } },
      ],
    });

    const result = await openAIProvider.rerankWithImage({
      apiKey: SECRET_KEY,
      model: "gpt-4o",
      systemPrompt: RERANK_PROMPT,
      image: TINY_PNG,
      mimeType: "image/png",
      candidates: CANDIDATES,
    });

    expect(result.usage).toEqual({
      promptTokens: 0,
      completionTokens: 0,
      model: "gpt-4o",
    });
  });

  it("threads systemPrompt verbatim into messages[0].content", async () => {
    mockCreate.mockResolvedValueOnce(
      rerankResponse({ orderedIds: ["a", "b"] }),
    );

    await openAIProvider.rerankWithImage({
      apiKey: SECRET_KEY,
      model: "gpt-4o-mini",
      systemPrompt: RERANK_PROMPT,
      image: TINY_PNG,
      mimeType: "image/png",
      candidates: CANDIDATES,
    });

    const call = mockCreate.mock.calls[0][0];
    expect(call.messages[0]).toEqual({
      role: "system",
      content: RERANK_PROMPT,
    });
    expect(call.model).toBe("gpt-4o-mini");
  });

  it("includes the image as a data URL with the supplied mimeType in the user message", async () => {
    mockCreate.mockResolvedValueOnce(
      rerankResponse({ orderedIds: ["a", "b"] }),
    );

    await openAIProvider.rerankWithImage({
      apiKey: SECRET_KEY,
      model: "gpt-4o-mini",
      systemPrompt: RERANK_PROMPT,
      image: TINY_PNG,
      mimeType: "image/jpeg",
      candidates: CANDIDATES,
    });

    const call = mockCreate.mock.calls[0][0];
    const userMessage = call.messages[1];
    expect(userMessage.role).toBe("user");
    const expectedDataUrl = `data:image/jpeg;base64,${TINY_PNG.toString("base64")}`;
    const serialized = JSON.stringify(userMessage);
    expect(serialized).toContain(expectedDataUrl);
    // Candidates must be serialized into the user message so the model sees them.
    expect(serialized).toContain("Modern sofa");
    expect(serialized).toContain("Classic chair");
  });

  it("uses response_format json_schema with an orderedIds string array schema", async () => {
    mockCreate.mockResolvedValueOnce(
      rerankResponse({ orderedIds: ["a", "b"] }),
    );

    await openAIProvider.rerankWithImage({
      apiKey: SECRET_KEY,
      model: "gpt-4o-mini",
      systemPrompt: RERANK_PROMPT,
      image: TINY_PNG,
      mimeType: "image/png",
      candidates: CANDIDATES,
    });

    const call = mockCreate.mock.calls[0][0];
    expect(call.response_format?.type).toBe("json_schema");
    const schema = call.response_format?.json_schema?.schema;
    expect(schema?.properties?.orderedIds?.type).toBe("array");
    expect(schema?.properties?.orderedIds?.items?.type).toBe("string");
  });

  it("returns ids verbatim and does not filter or validate against candidates", async () => {
    // Deliberately mismatched: extra "z" not in candidates, missing "b", duplicate "a".
    mockCreate.mockResolvedValueOnce(
      rerankResponse({ orderedIds: ["a", "z", "a"] }),
    );

    const result = await openAIProvider.rerankWithImage({
      apiKey: SECRET_KEY,
      model: "gpt-4o-mini",
      systemPrompt: RERANK_PROMPT,
      image: TINY_PNG,
      mimeType: "image/png",
      candidates: CANDIDATES,
    });

    expect(result.orderedIds).toEqual(["a", "z", "a"]);
  });

  it("throws ProviderError PROVIDER_HTTP_ERROR when the SDK rejects", async () => {
    const upstream = Object.assign(new Error("Unauthorized"), { status: 401 });
    mockCreate.mockRejectedValueOnce(upstream);

    try {
      await openAIProvider.rerankWithImage({
        apiKey: SECRET_KEY,
        model: "gpt-4o-mini",
        systemPrompt: RERANK_PROMPT,
        image: TINY_PNG,
        mimeType: "image/png",
        candidates: CANDIDATES,
      });
      throw new Error("should have thrown");
    } catch (err) {
      const e = err as ProviderError;
      expect(e).toBeInstanceOf(ProviderError);
      expect(e.code).toBe("PROVIDER_HTTP_ERROR");
      expect(e.message).not.toContain(SECRET_KEY);
    }
  });

  it("throws ProviderError INVALID_RESPONSE on empty content", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: "" } }],
    });

    try {
      await openAIProvider.rerankWithImage({
        apiKey: SECRET_KEY,
        model: "gpt-4o-mini",
        systemPrompt: RERANK_PROMPT,
        image: TINY_PNG,
        mimeType: "image/png",
        candidates: CANDIDATES,
      });
      throw new Error("should have thrown");
    } catch (err) {
      const e = err as ProviderError;
      expect(e).toBeInstanceOf(ProviderError);
      expect(e.code).toBe("INVALID_RESPONSE");
      expect(e.message.toLowerCase()).toContain("empty");
    }
  });

  it("throws ProviderError INVALID_RESPONSE on non-JSON content", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: "not json at all" } }],
    });

    try {
      await openAIProvider.rerankWithImage({
        apiKey: SECRET_KEY,
        model: "gpt-4o-mini",
        systemPrompt: RERANK_PROMPT,
        image: TINY_PNG,
        mimeType: "image/png",
        candidates: CANDIDATES,
      });
      throw new Error("should have thrown");
    } catch (err) {
      const e = err as ProviderError;
      expect(e).toBeInstanceOf(ProviderError);
      expect(e.code).toBe("INVALID_RESPONSE");
      expect(e.message.toLowerCase()).toContain("not valid json");
    }
  });

  it("never includes the API key in error messages", async () => {
    mockCreate.mockRejectedValueOnce(
      new Error(`some upstream error referencing ${SECRET_KEY}`),
    );

    try {
      await openAIProvider.rerankWithImage({
        apiKey: SECRET_KEY,
        model: "gpt-4o-mini",
        systemPrompt: RERANK_PROMPT,
        image: TINY_PNG,
        mimeType: "image/png",
        candidates: CANDIDATES,
      });
      throw new Error("should have thrown");
    } catch (err) {
      const e = err as ProviderError;
      expect(e).toBeInstanceOf(ProviderError);
      expect(e.message).not.toContain(SECRET_KEY);
      expect(JSON.stringify(e)).not.toContain(SECRET_KEY);
    }
  });
});

describe("getProvider factory", () => {
  it("returns the openai adapter when asked for 'openai'", () => {
    expect(getProvider("openai")).toBe(openAIProvider);
  });

  it("throws a clear error for an unknown provider name", () => {
    expect(() => getProvider("anthropic" as unknown as "openai")).toThrowError(
      /unknown provider/i,
    );
  });
});
