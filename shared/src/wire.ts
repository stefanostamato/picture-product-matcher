import type { Product } from "./catalog";

/**
 * Attributes the vision stage extracts from the uploaded image (optionally
 * refined by the user's prompt). All fields except `description` are
 * optional because the model is allowed to skip what it can't see — the
 * pipeline degrades gracefully rather than rejecting partial extractions.
 */
export interface ExtractedAttributes {
  /** Best-guess catalog category, e.g. "Sofas". Free-form string at the wire
   *  boundary; the catalog stage may snap it to `PRODUCT_CATEGORIES`. */
  category?: string;
  /** Sub-category within `category`, e.g. "Sectional". */
  type?: string;
  /** Style descriptor, e.g. "modern", "mid-century", "rustic". */
  style?: string;
  /** Dominant material, e.g. "leather", "oak", "velvet". */
  material?: string;
  /** Dominant color in plain English, e.g. "natural", "charcoal". */
  color?: string;
  /** Approximate dimensions in centimetres, when the image makes them inferable. */
  dimensions?: {
    width?: number;
    height?: number;
    depth?: number;
  };
  /** Coarse price hint, when inferable from materials/finish. */
  priceBand?: "low" | "mid" | "high";
  /**
   * Free-text summary the query-build stage feeds into Mongo's `$text`
   * search. Always present — even an unrecognizable image yields a
   * best-effort sentence so downstream stages have something to work with.
   */
  description: string;
}

/**
 * The shape the frontend assembles before posting to `POST /search`.
 *
 * On the wire this is sent as `multipart/form-data`:
 *   - `image`     — the binary file part (JPEG / PNG / WebP, ≤ 8MB)
 *   - `prompt`    — optional UTF-8 text field
 *   - `mimeType`  — derived server-side from the multipart part; included
 *                   here for the typed client so the provider call can
 *                   forward it without re-sniffing
 *
 * The user's API key travels in the `x-api-key` header, **not** in the
 * body, so it never lands in this type.
 */
export interface SearchRequest {
  /** Raw image bytes. `Uint8Array` works in both Node (Buffer is a subclass)
   *  and the browser (FormData accepts it via Blob/File). */
  image: Uint8Array;
  /** MIME type of `image`, one of `image/jpeg`, `image/png`, `image/webp`. */
  mimeType: string;
  /** Optional natural-language refinement the user typed alongside the image. */
  prompt?: string;
}

export interface SearchResponseMeta {
  /** Total wall-clock time spent inside `runPipeline`, in milliseconds. */
  latencyMs: number;
  /** Names of pipeline stages that actually ran, in execution order. */
  stagesRan: string[];
  /** Whatever the vision stage saw — surfaced so the UI can show the user
   *  why these results came back. */
  extracted: ExtractedAttributes;
  /** Aggregate LLM token usage across every provider call this pipeline
   *  made (vision extraction, optional rerank, etc.). `total` is just
   *  `prompt + completion`, surfaced so consumers don't have to recompute. */
  tokens: {
    prompt: number;
    completion: number;
    total: number;
  };
  /** Aggregate USD cost for the LLM calls this pipeline made, computed
   *  from token usage and the provider's rate card. */
  costUsd: number;
  /** Top 3 raw catalog hits before any rerank, exposed for the dev-only
   *  diagnostic panel and the eval harness. Empty when nothing matched. */
  topResults: Array<{
    productId: string;
    score: number;
  }>;
  /** True when the catalog stage returned zero or near-zero matches and the
   *  results are best-effort rather than confident. */
  lowConfidence?: boolean;
}

export interface SearchResponse {
  /** Ranked product matches, highest-relevance first. */
  results: Product[];
  meta: SearchResponseMeta;
}

/**
 * Wire shape for any non-2xx response from the backend. Both `code` and
 * `message` are required so the frontend can branch on `code` and always
 * has something to display.
 */
export interface ApiError {
  /** Machine-readable error code, e.g. `MISSING_API_KEY`, `PROVIDER_ERROR`. */
  code: string;
  /** Human-readable message safe to show the user. Never contains the API key. */
  message: string;
  /** HTTP status reported by the upstream model provider, when applicable.
   * Safe to surface — never the API key. */
  upstreamStatus?: number;
  /** Documented error code from the upstream provider (e.g.
   * `rate_limit_exceeded`, `insufficient_quota`, `model_not_found`,
   * `invalid_api_key`), when applicable. Safe to surface. */
  upstreamCode?: string;
}
