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
  /**
   * The system prompt the provider sends as the first message. The pipeline
   * sources this from `Config.visionPrompt` so admins can tune it at runtime;
   * adapters use it verbatim and ship no internal default.
   */
  systemPrompt: string;
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
 * Inputs the rerank stage hands to a provider's `rerankWithImage` call. The
 * provider is given the image, the user-tunable system prompt, and a flat
 * candidate list (id + minimal text). The adapter is responsible for
 * serializing the candidates into the user message; it must NOT validate that
 * returned ids match the input set — that defensive concern lives in the
 * pipeline so the adapter stays a thin transport.
 */
export interface RerankWithImageInput {
  apiKey: string;
  model: string;
  systemPrompt: string;
  image: Buffer;
  mimeType: string;
  candidates: Array<{ id: string; title: string; description: string }>;
}

/**
 * Result envelope returned by `rerankWithImage`. `orderedIds` is whatever the
 * model produced — verbatim, no filtering. The pipeline is responsible for
 * validating it as a permutation of the input ids and falling back on
 * mismatch. `usage` flows into the same token/cost aggregation path as
 * `extractFromImage` so the search response reports total cost across stages.
 */
export interface RerankWithImageResult {
  orderedIds: string[];
  usage: ProviderUsage;
}

/**
 * The single seam every model provider implements. Adding a new adapter is one
 * new file that exports an object satisfying this interface.
 */
export interface Provider {
  readonly name: string;
  extractFromImage(input: ExtractFromImageInput): Promise<ExtractFromImageResult>;
  rerankWithImage(input: RerankWithImageInput): Promise<RerankWithImageResult>;
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
