import type { ApiError } from "shared/wire";
import { ProviderError } from "../providers/index.js";

/**
 * The pair the route layer hands back to Express: an HTTP status plus an
 * `ApiError` body the frontend can branch on by `code`.
 */
export interface MappedError {
  status: number;
  body: ApiError;
}

/**
 * Sentinel error the route layer can throw before calling the pipeline. Keeps
 * the multipart-parsing path's failure modes typed without leaking through
 * `ProviderError`'s code namespace.
 */
export class RequestValidationError extends Error {
  readonly code:
    | "MISSING_API_KEY"
    | "MISSING_IMAGE"
    | "IMAGE_TOO_LARGE"
    | "UNSUPPORTED_MEDIA_TYPE";

  constructor(args: {
    code: RequestValidationError["code"];
    message: string;
  }) {
    super(args.message);
    this.name = "RequestValidationError";
    this.code = args.code;
  }
}

const VALIDATION_STATUS: Record<RequestValidationError["code"], number> = {
  MISSING_API_KEY: 400,
  MISSING_IMAGE: 400,
  IMAGE_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
};

/**
 * Turn any error the route catches into a wire-safe `ApiError`. The mapper
 * is the single defence-in-depth point that scrubs the per-request API key
 * from messages — even if an internal layer carelessly embeds it, the body
 * we return must not.
 */
export function mapErrorToResponse(error: unknown, apiKey?: string): MappedError {
  if (error instanceof RequestValidationError) {
    return {
      status: VALIDATION_STATUS[error.code],
      body: { code: error.code, message: scrub(error.message, apiKey) },
    };
  }

  if (error instanceof ProviderError) {
    if (error.code === "UNRECOGNIZED_IMAGE") {
      return {
        status: 422,
        body: {
          code: "UNRECOGNIZED_IMAGE",
          message: scrub(error.message, apiKey),
        },
      };
    }
    return {
      status: 502,
      body: {
        code: "PROVIDER_ERROR",
        message: scrub(error.message, apiKey),
      },
    };
  }

  return {
    status: 500,
    body: {
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred.",
    },
  };
}

function scrub(message: string, apiKey?: string): string {
  if (!apiKey || apiKey.length === 0) return message;
  // Replace every occurrence of the live key with a fixed placeholder so
  // accidental embedding by an internal layer can't escape the boundary.
  const safe = message.split(apiKey).join("[redacted]");
  return safe;
}
