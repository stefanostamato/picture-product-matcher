import type { ExtractedAttributes } from "shared/wire";

/**
 * Inputs every provider's vision-extraction call accepts. The API key is a
 * per-call argument — providers must never read it from env or log it.
 */
export interface ExtractFromImageInput {
  image: Buffer;
  mimeType: string;
  userPrompt?: string;
  apiKey: string;
  /** The vision model identifier, e.g. "gpt-4o-mini". Provider-specific. */
  model: string;
}

/**
 * The single seam every model provider implements. Adding a new adapter is one
 * new file that exports an object satisfying this interface.
 */
export interface Provider {
  readonly name: string;
  extractFromImage(input: ExtractFromImageInput): Promise<ExtractedAttributes>;
}

/**
 * Stable, machine-readable codes the API/error layer can branch on. Kept open
 * via the string fallback so a future provider can add its own without forcing
 * a shared enum bump.
 */
export type ProviderErrorCode =
  | "UNRECOGNIZED_IMAGE"
  | "PROVIDER_HTTP_ERROR"
  | "INVALID_RESPONSE"
  | (string & {});

/**
 * Error type the provider boundary throws. `code` is the machine-readable
 * branch; `message` is safe to surface to the user. Construction MUST scrub
 * the API key — callers are required to pass a message that does not embed
 * it, and the constructor defends in depth by refusing to keep one that does.
 */
export class ProviderError extends Error {
  readonly code: ProviderErrorCode;

  constructor(args: { code: ProviderErrorCode; message: string }) {
    super(args.message);
    this.name = "ProviderError";
    this.code = args.code;
  }
}
