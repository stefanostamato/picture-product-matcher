import { openAIProvider } from "./openai.js";
import type { Provider } from "./types.js";

export type ProviderName = "openai";

const REGISTRY: Record<ProviderName, Provider> = {
  openai: openAIProvider,
};

/**
 * Resolve a provider adapter by name. Adding a second adapter is a single new
 * file plus one entry in `REGISTRY` — callers stay oblivious to which
 * implementation runs.
 */
export function getProvider(name: ProviderName): Provider {
  const provider = REGISTRY[name];
  if (!provider) {
    throw new Error(`Unknown provider: ${String(name)}`);
  }
  return provider;
}

export type { Provider, ExtractFromImageInput, ProviderErrorCode } from "./types.js";
export { ProviderError } from "./types.js";
