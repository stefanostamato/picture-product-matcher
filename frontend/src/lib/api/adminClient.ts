import type {
  AdminConfig,
  AdminConfigUpdate,
  ApiError,
  HistoryResponse,
} from "shared/wire";

export class AdminClientError extends Error {
  readonly name = "AdminClientError";
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const API_BASE: string =
  (import.meta.env.VITE_API_URL as string | undefined) ??
  "http://localhost:3001";

const PASSWORD_HEADER = "x-admin-password";

async function parseError(response: Response): Promise<AdminClientError> {
  let parsed: Partial<ApiError> = {};
  try {
    parsed = (await response.json()) as Partial<ApiError>;
  } catch {
    parsed = {};
  }
  return new AdminClientError(
    parsed.code ?? "UNKNOWN",
    parsed.message ?? `Request failed with status ${response.status}`,
    response.status,
  );
}

export async function getAdminConfig(password: string): Promise<AdminConfig> {
  const response = await fetch(`${API_BASE}/admin/config`, {
    method: "GET",
    headers: { [PASSWORD_HEADER]: password },
  });
  if (!response.ok) throw await parseError(response);
  return (await response.json()) as AdminConfig;
}

export async function updateAdminConfig(
  password: string,
  patch: AdminConfigUpdate,
): Promise<AdminConfig> {
  const response = await fetch(`${API_BASE}/admin/config`, {
    method: "POST",
    headers: {
      [PASSWORD_HEADER]: password,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(patch),
  });
  if (!response.ok) throw await parseError(response);
  return (await response.json()) as AdminConfig;
}

export async function resetAdminConfig(password: string): Promise<AdminConfig> {
  const response = await fetch(`${API_BASE}/admin/config/reset`, {
    method: "POST",
    headers: { [PASSWORD_HEADER]: password },
  });
  if (!response.ok) throw await parseError(response);
  return (await response.json()) as AdminConfig;
}

export async function getAdminHistory(
  password: string,
): Promise<HistoryResponse> {
  const response = await fetch(`${API_BASE}/admin/history`, {
    method: "GET",
    headers: { [PASSWORD_HEADER]: password },
  });
  if (!response.ok) throw await parseError(response);
  return (await response.json()) as HistoryResponse;
}
