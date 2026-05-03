import type { ExtractedAttributes } from "shared/wire";
import type { Provider } from "../providers/index.js";

export interface VisionExtractInput {
  image: Buffer;
  mimeType: string;
  prompt?: string;
  apiKey: string;
}

export interface VisionExtractDeps {
  provider: Provider;
  visionModel: string;
}

// Thin adapter from the pipeline's named input shape to the provider's
// `extractFromImage` call. Kept tiny so the orchestrator stays linear.
export async function visionExtract(
  input: VisionExtractInput,
  deps: VisionExtractDeps,
): Promise<ExtractedAttributes> {
  return deps.provider.extractFromImage({
    image: input.image,
    mimeType: input.mimeType,
    apiKey: input.apiKey,
    model: deps.visionModel,
    ...(input.prompt !== undefined ? { userPrompt: input.prompt } : {}),
  });
}
