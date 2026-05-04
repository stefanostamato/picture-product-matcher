import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import type { AdminConfig, HistoryResponse } from "shared/wire";

vi.mock("../lib/api/adminClient", async () => {
  const actual =
    await vi.importActual<typeof import("../lib/api/adminClient")>(
      "../lib/api/adminClient",
    );
  return {
    ...actual,
    getAdminConfig: vi.fn(),
    getAdminHistory: vi.fn(),
    updateAdminConfig: vi.fn(),
    resetAdminConfig: vi.fn(),
  };
});

import {
  AdminClientError,
  getAdminConfig,
  getAdminHistory,
} from "../lib/api/adminClient";
import { Admin } from "./Admin";

const baseConfig: AdminConfig = {
  topK: 20,
  rerank: true,
  provider: "openai",
  visionModel: "gpt-4o-mini",
  visionPrompt: "vp",
  rerankModel: "gpt-4o-mini",
  rerankPrompt: "rp",
  rerankTopN: 10,
};

const emptyHistory: HistoryResponse = { rows: [] };

const STORAGE_KEY = "adminPassword";

describe("Admin page", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.mocked(getAdminConfig).mockReset();
    vi.mocked(getAdminHistory).mockReset();
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  it("renders the login form when there is no password in session", () => {
    render(<Admin />);
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(getAdminConfig).not.toHaveBeenCalled();
  });

  it("renders config form and history table after fetching with a valid password", async () => {
    sessionStorage.setItem(STORAGE_KEY, "good-pw");
    vi.mocked(getAdminConfig).mockResolvedValue(baseConfig);
    vi.mocked(getAdminHistory).mockResolvedValue(emptyHistory);

    render(<Admin />);

    await waitFor(() =>
      expect(getAdminConfig).toHaveBeenCalledWith("good-pw"),
    );
    expect(getAdminHistory).toHaveBeenCalledWith("good-pw");

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /save/i })).toBeInTheDocument(),
    );
    // empty history empty-state
    expect(screen.getByText(/no eval runs/i)).toBeInTheDocument();
  });

  it("clicking Logout clears session and re-renders the login form", async () => {
    sessionStorage.setItem(STORAGE_KEY, "good-pw");
    vi.mocked(getAdminConfig).mockResolvedValue(baseConfig);
    vi.mocked(getAdminHistory).mockResolvedValue(emptyHistory);

    render(<Admin />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /save/i })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: /log ?out/i }));

    await waitFor(() =>
      expect(screen.getByLabelText(/password/i)).toBeInTheDocument(),
    );
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("logs out and shows the login form when a fetch returns 401", async () => {
    sessionStorage.setItem(STORAGE_KEY, "stale-pw");
    vi.mocked(getAdminConfig).mockRejectedValue(
      new AdminClientError("ADMIN_AUTH_INVALID", "Invalid admin password.", 401),
    );
    vi.mocked(getAdminHistory).mockResolvedValue(emptyHistory);

    render(<Admin />);

    await waitFor(() =>
      expect(screen.getByLabelText(/password/i)).toBeInTheDocument(),
    );
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
