import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { SearchResponseMeta } from "shared/wire";
import { DiagPanel } from "./DiagPanel";

const fullMeta: SearchResponseMeta = {
  latencyMs: 123,
  stagesRan: ["visionExtract", "queryBuild", "catalogSearch"],
  extracted: {
    description: "modern leather sofa",
    category: "Sofas",
    type: "Sectional",
    style: "modern",
    material: "leather",
    color: "charcoal",
  },
  tokens: { prompt: 100, completion: 50, total: 150 },
  costUsd: 0.0012345,
  topResults: [
    { productId: "p1", score: 9.5 },
    { productId: "p2", score: 7.25 },
    { productId: "p3", score: 4.1 },
  ],
};

describe("DiagPanel", () => {
  it("renders all sections given a fixture meta", () => {
    render(<DiagPanel meta={fullMeta} />);

    // Collapsible <details> wrapper exists and is open by default.
    const details = screen.getByTestId("diag-panel");
    expect(details.tagName.toLowerCase()).toBe("details");

    // Extracted attributes — keys and values both surface.
    expect(screen.getByText("category")).toBeInTheDocument();
    expect(screen.getByText("Sofas")).toBeInTheDocument();
    expect(screen.getByText("type")).toBeInTheDocument();
    expect(screen.getByText("Sectional")).toBeInTheDocument();
    expect(screen.getByText("material")).toBeInTheDocument();
    expect(screen.getByText("leather")).toBeInTheDocument();

    // Built query — best-effort string assembled from extracted attrs.
    const query = screen.getByTestId("diag-built-query");
    expect(query.textContent).toMatch(/Sofas/);
    expect(query.textContent).toMatch(/Sectional/);
    expect(query.textContent).toMatch(/leather/);

    // Top-3 results render id + score.
    const top = screen.getByTestId("diag-top-results");
    expect(within(top).getByText("p1")).toBeInTheDocument();
    expect(within(top).getByText(/9\.5/)).toBeInTheDocument();
    expect(within(top).getByText("p2")).toBeInTheDocument();
    expect(within(top).getByText("p3")).toBeInTheDocument();

    // Latency total + stage list.
    const latency = screen.getByTestId("diag-latency");
    expect(latency.textContent).toMatch(/123/);
    expect(within(latency).getByText("visionExtract")).toBeInTheDocument();
    expect(within(latency).getByText("queryBuild")).toBeInTheDocument();
    expect(within(latency).getByText("catalogSearch")).toBeInTheDocument();

    // Tokens prompt / completion / total.
    const tokens = screen.getByTestId("diag-tokens");
    expect(tokens.textContent).toMatch(/100/);
    expect(tokens.textContent).toMatch(/50/);
    expect(tokens.textContent).toMatch(/150/);

    // Cost formatted to 5 decimals.
    expect(screen.getByTestId("diag-cost").textContent).toMatch(/0\.00123/);
  });

  it("does not crash when topResults is empty", () => {
    const meta: SearchResponseMeta = { ...fullMeta, topResults: [] };
    render(<DiagPanel meta={meta} />);
    const top = screen.getByTestId("diag-top-results");
    expect(top).toBeInTheDocument();
    // No row entries.
    expect(within(top).queryByText("p1")).toBeNull();
  });

  it("renders stage names in the order of stagesRan", () => {
    const meta: SearchResponseMeta = {
      ...fullMeta,
      stagesRan: ["catalogSearch", "queryBuild", "visionExtract"],
    };
    render(<DiagPanel meta={meta} />);
    const items = screen
      .getByTestId("diag-latency")
      .querySelectorAll("[data-stage]");
    expect(Array.from(items).map((el) => el.getAttribute("data-stage"))).toEqual(
      ["catalogSearch", "queryBuild", "visionExtract"],
    );
  });
});
