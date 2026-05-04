import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { AdminConfig, HistoryRow } from "shared/wire";
import { AdminHistoryTable } from "./AdminHistoryTable";

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

function makeRow(overrides: Partial<HistoryRow> = {}): HistoryRow {
  return {
    ts: "2026-05-01T12:00:00.000Z",
    gitSha: "abcdef1234567890",
    gitDirty: false,
    goldSetVersion: "v1",
    n: 30,
    config: baseConfig,
    metrics: {
      recallAt1: 0.4,
      recallAt5: 0.7,
      recallAt20: 0.9,
      mrr: 0.55,
      meanAttributeOverlap: 0.5,
      categoryHitRate: 0.8,
      typeHitRate: 0.6,
      p50LatencyMs: 1200,
      p95LatencyMs: 2500,
      totalTokens: 12345,
      totalCostUsd: 0.0123,
      failureCounts: {},
    },
    byCategory: {},
    ...overrides,
  };
}

describe("AdminHistoryTable", () => {
  it("renders one row per HistoryRow", () => {
    const rows = [
      makeRow({ ts: "2026-05-01T12:00:00.000Z" }),
      makeRow({ ts: "2026-05-02T12:00:00.000Z" }),
      makeRow({ ts: "2026-05-03T12:00:00.000Z" }),
    ];
    render(<AdminHistoryTable rows={rows} />);
    const bodyRows = screen.getAllByRole("row").slice(1); // skip header
    expect(bodyRows).toHaveLength(3);
  });

  it("renders an empty-state message containing 'No eval runs' when rows is empty", () => {
    render(<AdminHistoryTable rows={[]} />);
    expect(screen.getByText(/no eval runs/i)).toBeInTheDocument();
  });

  it("shows only the first 7 characters of gitSha", () => {
    const rows = [makeRow({ gitSha: "abcdef1234567890" })];
    render(<AdminHistoryTable rows={rows} />);
    const bodyRows = screen.getAllByRole("row").slice(1);
    const cells = within(bodyRows[0]).getAllByRole("cell");
    const allText = cells.map((c) => c.textContent ?? "").join(" | ");
    expect(allText).toContain("abcdef1");
    expect(allText).not.toContain("abcdef12");
  });

  it("formats the cost column with a $ prefix", () => {
    const rows = [
      makeRow({
        metrics: {
          ...makeRow().metrics,
          totalCostUsd: 0.0123,
        },
      }),
    ];
    render(<AdminHistoryTable rows={rows} />);
    const bodyRows = screen.getAllByRole("row").slice(1);
    const cells = within(bodyRows[0]).getAllByRole("cell");
    const costCell = cells[cells.length - 1];
    expect(costCell.textContent).toMatch(/^\$/);
  });
});
