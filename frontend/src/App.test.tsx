import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AppRoutes } from "./App";
import { ApiKeyProvider } from "./lib/state/apiKey";

const renderAt = (path: string) =>
  render(
    <ApiKeyProvider>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </ApiKeyProvider>,
  );

describe("App routing", () => {
  it("renders the public search page at /", () => {
    renderAt("/");
    expect(
      screen.getByRole("heading", { name: /picture product matcher/i }),
    ).toBeInTheDocument();
  });

  it("renders the placeholder admin page at /admin", () => {
    renderAt("/admin");
    expect(
      screen.getByRole("heading", { name: /^admin$/i }),
    ).toBeInTheDocument();
  });

  it("falls back to the public search page for unknown routes", () => {
    renderAt("/garbage");
    expect(
      screen.getByRole("heading", { name: /picture product matcher/i }),
    ).toBeInTheDocument();
  });
});
