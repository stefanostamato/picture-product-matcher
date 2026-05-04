import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Product } from "shared/catalog";
import type { SearchResponse } from "shared/wire";
import { appendHistory, printReport } from "./reporter.js";
import type { EvalReport, EvalRow, GoldItem } from "./types.js";

const product = (id: string): Product => ({
  _id: id,
  title: `Title ${id}`,
  description: `Description ${id}`,
  category: "Sofas",
  type: "Sectional",
  price: 100,
  width: 200,
  height: 80,
  depth: 90,
});

const gold = (overrides: Partial<GoldItem> = {}): GoldItem => ({
  productId: "p1",
  category: "Sofas",
  type: "Sectional",
  title: "Gold Sofa",
  description: "x",
  color: [],
  material: [],
  style: [],
  ...overrides,
});

const response = (results: Product[]): SearchResponse => ({
  results,
  meta: {
    latencyMs: 100,
    stagesRan: ["visionExtract", "queryBuild", "catalogSearch"],
    extracted: { description: "stub" },
    tokens: { prompt: 10, completion: 5, total: 15 },
    costUsd: 0.0001,
    topResults: [],
  },
});

const row = (id: string, category: string, hit: boolean): EvalRow => ({
  goldItem: gold({ productId: id, category }),
  response: response(hit ? [product(id)] : [product("other")]),
  scores: {
    recallAt1: hit ? 1 : 0,
    recallAt5: hit ? 1 : 0,
    recallAt20: hit ? 1 : 0,
    reciprocalRank: hit ? 1 : 0,
    categoryHit: true,
    typeHit: true,
    attributeOverlap: hit ? 1 : 0,
  },
});

const sampleReport = (): EvalReport => {
  const rows = [
    row("a", "Sofas", true),
    row("b", "Chairs", false),
  ];
  return {
    overall: {
      n: 2,
      recallAt1: 0.5,
      recallAt5: 0.5,
      recallAt20: 0.5,
      mrr: 0.5,
      categoryHitRate: 1,
      typeHitRate: 1,
      meanAttributeOverlap: 0.5,
      p50LatencyMs: 100,
      p95LatencyMs: 100,
      totalTokens: 30,
      totalCostUsd: 0.0002,
      failures: { missingTarget: 1, categoryMiss: 0, typeMiss: 0 },
    },
    byCategory: {
      Sofas: {
        n: 1,
        recallAt1: 1,
        recallAt5: 1,
        recallAt20: 1,
        mrr: 1,
        categoryHitRate: 1,
        typeHitRate: 1,
        meanAttributeOverlap: 1,
        p50LatencyMs: 100,
        p95LatencyMs: 100,
        totalTokens: 15,
        totalCostUsd: 0.0001,
        failures: { missingTarget: 0, categoryMiss: 0, typeMiss: 0 },
      },
      Chairs: {
        n: 1,
        recallAt1: 0,
        recallAt5: 0,
        recallAt20: 0,
        mrr: 0,
        categoryHitRate: 1,
        typeHitRate: 1,
        meanAttributeOverlap: 0,
        p50LatencyMs: 100,
        p95LatencyMs: 100,
        totalTokens: 15,
        totalCostUsd: 0.0001,
        failures: { missingTarget: 1, categoryMiss: 0, typeMiss: 0 },
      },
    },
    runs: rows,
  };
};

describe("appendHistory", () => {
  let dir: string;
  let path: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "eval-history-"));
    path = join(dir, "history.jsonl");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("writes exactly one valid JSON line containing all required fields", async () => {
    const report = sampleReport();
    const config = { topK: 20, rerank: false, provider: "openai", visionModel: "gpt-4o-mini" };

    await appendHistory(report, config, "abc123", { dirty: false, path });

    const text = await readFile(path, "utf8");
    const lines = text.trim().split("\n");
    expect(lines).toHaveLength(1);

    const parsed = JSON.parse(lines[0]);
    expect(typeof parsed.ts).toBe("string");
    expect(parsed.gitSha).toBe("abc123");
    expect(parsed.gitDirty).toBe(false);
    expect(parsed.config).toEqual(config);
    expect(parsed.goldSetVersion).toBe("v1");
    expect(parsed.n).toBe(2);
    expect(parsed.metrics).toEqual(report.overall);
    expect(parsed.byCategory).toEqual(report.byCategory);
  });

  it("respects an injected goldSetVersion", async () => {
    const report = sampleReport();
    await appendHistory(report, {}, "sha", {
      dirty: true,
      path,
      goldSetVersion: "v2",
    });

    const text = await readFile(path, "utf8");
    const parsed = JSON.parse(text.trim());
    expect(parsed.goldSetVersion).toBe("v2");
    expect(parsed.gitDirty).toBe(true);
  });

  it("appends a second line without truncating the first", async () => {
    const report = sampleReport();
    await appendHistory(report, {}, "sha-1", { dirty: false, path });
    await appendHistory(report, {}, "sha-2", { dirty: false, path });

    const text = await readFile(path, "utf8");
    const lines = text.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).gitSha).toBe("sha-1");
    expect(JSON.parse(lines[1]).gitSha).toBe("sha-2");
  });

  it("creates the file when missing and preserves a pre-existing partial line", async () => {
    // Pre-populate with one existing line (no trailing newline).
    await writeFile(path, '{"existing":"row"}\n', "utf8");

    const report = sampleReport();
    await appendHistory(report, {}, "sha", { dirty: false, path });

    const text = await readFile(path, "utf8");
    const lines = text.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toEqual({ existing: "row" });
    expect(JSON.parse(lines[1]).gitSha).toBe("sha");
  });
});

describe("printReport", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let captured: string[];

  beforeEach(() => {
    captured = [];
    logSpy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      captured.push(args.map(String).join(" "));
    });
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("prints overall metrics with recall@5 label and a $ figure", () => {
    printReport(sampleReport());
    const out = captured.join("\n");
    expect(out).toContain("recall@5");
    expect(out).toContain("$");
  });

  it("prints a per-category section header and one row per category", () => {
    printReport(sampleReport());
    const out = captured.join("\n");
    expect(out.toLowerCase()).toContain("category");
    expect(out).toContain("Sofas");
    expect(out).toContain("Chairs");
  });

  it("does not print anything that looks like an OpenAI key", () => {
    printReport(sampleReport());
    const out = captured.join("\n");
    expect(out).not.toMatch(/sk-[A-Za-z0-9]/);
  });
});
