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
 * Token + model accounting returned alongside each extraction call. The
 * pipeline aggregates these to compute per-request cost via the pricing table.
 * `model` is echoed back so the orchestrator does not have to thread it
 * through separately, and so non-OpenAI adapters can report whatever
 * identifier their pricing table keys on.
 */
export interface ProviderUsage {
  promptTokens: number;
  completionTokens: number;
  model: string;
}

/**
 * Result envelope returned by `extractFromImage`. Splits the parsed attributes
 * from accounting metadata so callers that don't care about cost can ignore
 * `usage` cleanly.
 */
export interface ExtractFromImageResult {
  extracted: ExtractedAttributes;
  usage: ProviderUsage;
}

/**
 * The single seam every model provider implements. Adding a new adapter is one
 * new file that exports an object satisfying this interface.
 */
export interface Provider {
  readonly name: string;
  extractFromImage(input: ExtractFromImageInput): Promise<ExtractFromImageResult>;
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
  /** HTTP status reported by the upstream API, when the failure was a network
   * call. Safe to surface in logs — never contains the API key. */
  readonly upstreamStatus?: number;
  /** Machine-readable code from the upstream API (e.g. "insufficient_quota",
   * "model_not_found", "invalid_api_key"). Safe to surface in logs. */
  readonly upstreamCode?: string;

  constructor(args: {
    code: ProviderErrorCode;
    message: string;
    upstreamStatus?: number;
    upstreamCode?: string;
  }) {
    super(args.message);
    this.name = "ProviderError";
    this.code = args.code;
    this.upstreamStatus = args.upstreamStatus;
    this.upstreamCode = args.upstreamCode;
  }
}
