import type { Provider } from "../providers/index.js";
import type { ExtractFromImageResult } from "../providers/types.js";

export interface VisionExtractInput {
  image: Buffer;
  mimeType: string;
  prompt?: string;
  apiKey: string;
}

export interface VisionExtractDeps {
  provider: Provider;
  visionModel: string;
  visionPrompt: string;
}

// Thin adapter from the pipeline's named input shape to the provider's
// `extractFromImage` call. Returns the full `{ extracted, usage }` envelope so
// the orchestrator can aggregate token usage across stages.
export async function visionExtract(
  input: VisionExtractInput,
  deps: VisionExtractDeps,
): Promise<ExtractFromImageResult> {
  return deps.provider.extractFromImage({
    image: input.image,
    mimeType: input.mimeType,
    apiKey: input.apiKey,
    model: deps.visionModel,
    systemPrompt: deps.visionPrompt,
    ...(input.prompt !== undefined ? { userPrompt: input.prompt } : {}),
  });
}
