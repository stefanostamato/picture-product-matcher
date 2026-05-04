import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { AdminConfig } from "shared/wire";

vi.mock("../lib/api/adminClient", async () => {
  const actual =
    await vi.importActual<typeof import("../lib/api/adminClient")>(
      "../lib/api/adminClient",
    );
  return {
    ...actual,
    updateAdminConfig: vi.fn(),
    resetAdminConfig: vi.fn(),
  };
});

import {
  AdminClientError,
  resetAdminConfig,
  updateAdminConfig,
} from "../lib/api/adminClient";
import { AdminConfigForm } from "./AdminConfigForm";

const baseConfig: AdminConfig = {
  topK: 20,
  rerank: true,
  provider: "openai",
  visionModel: "gpt-4o-mini",
  visionPrompt: "vision prompt fixture",
  rerankModel: "gpt-4o-mini",
  rerankPrompt: "rerank prompt fixture",
  rerankTopN: 10,
};

function getInput(label: RegExp): HTMLInputElement {
  return screen.getByLabelText(label) as HTMLInputElement;
}

function getTextarea(label: RegExp): HTMLTextAreaElement {
  return screen.getByLabelText(label) as HTMLTextAreaElement;
}

describe("AdminConfigForm", () => {
  beforeEach(() => {
    vi.mocked(updateAdminConfig).mockReset();
    vi.mocked(resetAdminConfig).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders all seven fields populated from initial", () => {
    render(<AdminConfigForm initial={baseConfig} password="pw" />);

    expect(getInput(/top[\s-]?k/i).value).toBe("20");
    expect(getInput(/^rerank$/i).checked).toBe(true);
    expect(getInput(/vision model/i).value).toBe("gpt-4o-mini");
    expect(getTextarea(/vision prompt/i).value).toBe("vision prompt fixture");
    expect(getInput(/rerank model/i).value).toBe("gpt-4o-mini");
    expect(getTextarea(/rerank prompt/i).value).toBe("rerank prompt fixture");
    expect(getInput(/rerank top[\s-]?n/i).value).toBe("10");
  });

  it("editing topK and saving calls updateAdminConfig with only that key", async () => {
    vi.mocked(updateAdminConfig).mockResolvedValue({ ...baseConfig, topK: 5 });
    render(<AdminConfigForm initial={baseConfig} password="pw" />);

    fireEvent.change(getInput(/top[\s-]?k/i), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(updateAdminConfig).toHaveBeenCalledOnce());
    expect(updateAdminConfig).toHaveBeenCalledWith("pw", { topK: 5 });
  });

  it("editing rerankTopN and saving calls updateAdminConfig with only that key", async () => {
    vi.mocked(updateAdminConfig).mockResolvedValue({
      ...baseConfig,
      rerankTopN: 8,
    });
    render(<AdminConfigForm initial={baseConfig} password="pw" />);

    fireEvent.change(getInput(/rerank top[\s-]?n/i), {
      target: { value: "8" },
    });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(updateAdminConfig).toHaveBeenCalledOnce());
    expect(updateAdminConfig).toHaveBeenCalledWith("pw", { rerankTopN: 8 });
  });

  it("unchecking rerank disables rerank model/prompt/topN inputs but preserves values; values still sent on next save", async () => {
    vi.mocked(updateAdminConfig).mockResolvedValue({
      ...baseConfig,
      rerank: false,
    });
    render(<AdminConfigForm initial={baseConfig} password="pw" />);

    const rerankToggle = getInput(/^rerank$/i);
    fireEvent.click(rerankToggle);

    expect(getInput(/rerank model/i).disabled).toBe(true);
    expect(getTextarea(/rerank prompt/i).disabled).toBe(true);
    expect(getInput(/rerank top[\s-]?n/i).disabled).toBe(true);
    // values preserved
    expect(getInput(/rerank model/i).value).toBe("gpt-4o-mini");
    expect(getTextarea(/rerank prompt/i).value).toBe("rerank prompt fixture");
    expect(getInput(/rerank top[\s-]?n/i).value).toBe("10");

    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(updateAdminConfig).toHaveBeenCalledOnce());
    expect(updateAdminConfig).toHaveBeenCalledWith("pw", { rerank: false });
  });

  it("calls onSaved with the response after a successful save", async () => {
    const next: AdminConfig = { ...baseConfig, topK: 7 };
    vi.mocked(updateAdminConfig).mockResolvedValue(next);
    const onSaved = vi.fn();
    render(
      <AdminConfigForm initial={baseConfig} password="pw" onSaved={onSaved} />,
    );

    fireEvent.change(getInput(/top[\s-]?k/i), { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(next));
  });

  it("shows the error message when save fails", async () => {
    vi.mocked(updateAdminConfig).mockRejectedValue(
      new AdminClientError("ADMIN_CONFIG_INVALID", "topK must be 1..100", 400),
    );
    render(<AdminConfigForm initial={baseConfig} password="pw" />);

    fireEvent.change(getInput(/top[\s-]?k/i), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() =>
      expect(screen.getByText(/topK must be 1\.\.100/)).toBeInTheDocument(),
    );
  });

  it("Reset after window.confirm true calls resetAdminConfig and re-populates fields", async () => {
    const resetResponse: AdminConfig = {
      ...baseConfig,
      topK: 99,
      visionPrompt: "fresh-vp",
    };
    vi.mocked(resetAdminConfig).mockResolvedValue(resetResponse);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    try {
      render(<AdminConfigForm initial={baseConfig} password="pw" />);

      fireEvent.click(screen.getByRole("button", { name: /reset/i }));
      await waitFor(() => expect(resetAdminConfig).toHaveBeenCalledWith("pw"));
      await waitFor(() =>
        expect(getInput(/top[\s-]?k/i).value).toBe("99"),
      );
      expect(getTextarea(/vision prompt/i).value).toBe("fresh-vp");
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it("does not call resetAdminConfig when window.confirm returns false", () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    try {
      render(<AdminConfigForm initial={baseConfig} password="pw" />);
      fireEvent.click(screen.getByRole("button", { name: /reset/i }));
      expect(resetAdminConfig).not.toHaveBeenCalled();
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it("disables Save while a save is in flight", async () => {
    let resolveFn: ((v: AdminConfig) => void) | undefined;
    vi.mocked(updateAdminConfig).mockReturnValue(
      new Promise<AdminConfig>((resolve) => {
        resolveFn = resolve;
      }),
    );
    render(<AdminConfigForm initial={baseConfig} password="pw" />);

    fireEvent.change(getInput(/top[\s-]?k/i), { target: { value: "5" } });
    const saveBtn = screen.getByRole("button", {
      name: /save/i,
    }) as HTMLButtonElement;
    fireEvent.click(saveBtn);

    await waitFor(() => expect(saveBtn.disabled).toBe(true));

    resolveFn?.({ ...baseConfig, topK: 5 });
    await waitFor(() => expect(saveBtn.disabled).toBe(false));
  });
});
