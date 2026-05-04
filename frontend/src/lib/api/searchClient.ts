import type { ApiError, SearchResponse } from "shared/wire";

export interface SearchClientInput {
  apiKey: string;
  image: File;
  prompt?: string;
}

export class SearchClientError extends Error {
  readonly name = "SearchClientError";
  readonly code: string;
  readonly status: number;
  readonly upstreamStatus?: number;
  readonly upstreamCode?: string;

  constructor(
    code: string,
    message: string,
    status: number,
    upstream?: { upstreamStatus?: number; upstreamCode?: string },
  ) {
    super(message);
    this.code = code;
    this.status = status;
    this.upstreamStatus = upstream?.upstreamStatus;
    this.upstreamCode = upstream?.upstreamCode;
  }
}

const API_BASE: string =
  (import.meta.env.VITE_API_URL as string | undefined) ??
  "http://localhost:3001";

export async function searchClient(
  input: SearchClientInput,
): Promise<SearchResponse> {
  const body = new FormData();
  body.append("image", input.image);
  if (input.prompt !== undefined && input.prompt !== "") {
    body.append("prompt", input.prompt);
  }

  // Deliberately do NOT set Content-Type — the browser appends the
  // multipart boundary automatically.
  const response = await fetch(`${API_BASE}/search`, {
    method: "POST",
    headers: { "x-api-key": input.apiKey },
    body,
  });

  if (!response.ok) {
    let parsed: Partial<ApiError> = {};
    try {
      parsed = (await response.json()) as Partial<ApiError>;
    } catch {
      parsed = {};
    }
    throw new SearchClientError(
      parsed.code ?? "UNKNOWN",
      parsed.message ?? `Request failed with status ${response.status}`,
      response.status,
      {
        upstreamStatus: parsed.upstreamStatus,
        upstreamCode: parsed.upstreamCode,
      },
    );
  }

  return (await response.json()) as SearchResponse;
}
