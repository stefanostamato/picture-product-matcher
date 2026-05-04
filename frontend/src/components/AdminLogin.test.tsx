import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import type { AdminConfig } from "shared/wire";
import { AdminAuthProvider, useAdminAuth } from "../lib/state/adminAuth";
import { AdminLogin } from "./AdminLogin";

vi.mock("../lib/api/adminClient", async () => {
  const actual =
    await vi.importActual<typeof import("../lib/api/adminClient")>(
      "../lib/api/adminClient",
    );
  return {
    ...actual,
    getAdminConfig: vi.fn(),
  };
});

import { AdminClientError, getAdminConfig } from "../lib/api/adminClient";

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

function renderLogin(onAuthed: () => void) {
  return render(
    <AdminAuthProvider>
      <AdminLogin onAuthed={onAuthed} />
      <PasswordProbe />
    </AdminAuthProvider>,
  );
}

function PasswordProbe() {
  const { password } = useAdminAuth();
  return <span data-testid="probe-password">{password ?? "<none>"}</span>;
}

function submit(password: string) {
  const input = screen.getByLabelText(/password/i) as HTMLInputElement;
  fireEvent.change(input, { target: { value: password } });
  const button = screen.getByRole("button", {
    name: /sign in|log in|submit/i,
  });
  fireEvent.click(button);
}

describe("AdminLogin", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.mocked(getAdminConfig).mockReset();
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  it("renders a password input of type=password", () => {
    renderLogin(() => {});
    const input = screen.getByLabelText(/password/i);
    expect(input).toHaveAttribute("type", "password");
  });

  it("calls onAuthed and stores the password when the password is correct", async () => {
    vi.mocked(getAdminConfig).mockResolvedValue(baseConfig);
    const onAuthed = vi.fn();
    renderLogin(onAuthed);

    submit("right-pw");

    await waitFor(() => expect(onAuthed).toHaveBeenCalledOnce());
    expect(getAdminConfig).toHaveBeenCalledWith("right-pw");
    expect(screen.getByTestId("probe-password").textContent).toBe("right-pw");
  });

  it("shows 'Incorrect password' when the server rejects with ADMIN_AUTH_INVALID", async () => {
    vi.mocked(getAdminConfig).mockRejectedValue(
      new AdminClientError("ADMIN_AUTH_INVALID", "Invalid admin password.", 401),
    );
    const onAuthed = vi.fn();
    renderLogin(onAuthed);

    submit("wrong-pw");

    await waitFor(() =>
      expect(screen.getByText(/incorrect password/i)).toBeInTheDocument(),
    );
    expect(onAuthed).not.toHaveBeenCalled();
    expect(screen.getByTestId("probe-password").textContent).toBe("<none>");
  });

  it("shows a generic error on non-auth failures", async () => {
    vi.mocked(getAdminConfig).mockRejectedValue(
      new AdminClientError("UNKNOWN", "Boom", 500),
    );
    const onAuthed = vi.fn();
    renderLogin(onAuthed);

    submit("any-pw");

    await waitFor(() => {
      const msg = screen.getByTestId("admin-login-error").textContent ?? "";
      // Generic error — should NOT be the specific "Incorrect password" message.
      expect(msg.length).toBeGreaterThan(0);
      expect(msg.toLowerCase()).not.toContain("incorrect password");
    });
    expect(onAuthed).not.toHaveBeenCalled();
  });
});
