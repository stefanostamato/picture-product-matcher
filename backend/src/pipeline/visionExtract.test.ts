import { describe, it, expect, vi } from "vitest";
import type { ExtractedAttributes } from "shared/wire";
import type { Provider } from "../providers/index.js";
import type { ExtractFromImageResult } from "../providers/types.js";
import { ProviderError } from "../providers/index.js";
import { visionExtract } from "./visionExtract.js";

const TINY_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

function fakeProvider(
  fn: (input: Parameters<Provider["extractFromImage"]>[0]) => Promise<ExtractFromImageResult>,
): Provider {
  return {
    name: "fake",
    extractFromImage: vi.fn(fn) as Provider["extractFromImage"],
    rerankWithImage: vi.fn() as Provider["rerankWithImage"],
  };
}

describe("visionExtract stage", () => {
  it("calls provider.extractFromImage with the inputs and returns the full result envelope", async () => {
    const extracted: ExtractedAttributes = {
      category: "Sofas",
      description: "A modern grey sectional",
    };
    const expected: ExtractFromImageResult = {
      extracted,
      usage: { promptTokens: 100, completionTokens: 50, model: "gpt-4o-mini" },
    };
    const provider = fakeProvider(async () => expected);

    const result = await visionExtract(
      {
        image: TINY_PNG,
        mimeType: "image/png",
        prompt: "rustic feel",
        apiKey: "sk-test",
      },
      {
        provider,
        visionModel: "gpt-4o-mini",
        visionPrompt: "fixture-prompt",
      },
    );

    expect(result).toEqual(expected);
    expect(result.extracted).toEqual(extracted);
    expect(result.usage).toEqual({
      promptTokens: 100,
      completionTokens: 50,
      model: "gpt-4o-mini",
    });
    expect(provider.extractFromImage).toHaveBeenCalledWith({
      image: TINY_PNG,
      mimeType: "image/png",
      userPrompt: "rustic feel",
      apiKey: "sk-test",
      model: "gpt-4o-mini",
      systemPrompt: "fixture-prompt",
    });
  });

  it("omits userPrompt when no prompt was supplied", async () => {
    const provider = fakeProvider(async () => ({
      extracted: { description: "x" },
      usage: { promptTokens: 0, completionTokens: 0, model: "gpt-4o" },
    }));

    await visionExtract(
      { image: TINY_PNG, mimeType: "image/jpeg", apiKey: "k" },
      { provider, visionModel: "gpt-4o", visionPrompt: "fixture-prompt" },
    );

    const arg = (provider.extractFromImage as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(arg.userPrompt).toBeUndefined();
    expect(arg.model).toBe("gpt-4o");
    expect(arg.systemPrompt).toBe("fixture-prompt");
  });

  it("forwards visionPrompt from deps to the provider as systemPrompt", async () => {
    const provider = fakeProvider(async () => ({
      extracted: { description: "y" },
      usage: { promptTokens: 0, completionTokens: 0, model: "m" },
    }));

    await visionExtract(
      { image: TINY_PNG, mimeType: "image/png", apiKey: "k" },
      { provider, visionModel: "m", visionPrompt: "fixture-prompt" },
    );

    const arg = (provider.extractFromImage as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(arg.systemPrompt).toBe("fixture-prompt");
  });

  it("propagates ProviderError thrown by the provider", async () => {
    const provider = fakeProvider(async () => {
      throw new ProviderError({
        code: "UNRECOGNIZED_IMAGE",
        message: "nope",
      });
    });

    await expect(
      visionExtract(
        { image: TINY_PNG, mimeType: "image/png", apiKey: "k" },
        { provider, visionModel: "m", visionPrompt: "fixture-prompt" },
      ),
    ).rejects.toBeInstanceOf(ProviderError);
  });
});
