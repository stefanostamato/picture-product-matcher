import { appendFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { EvalReport, HistoryRow, OverallMetrics } from "./types.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_HISTORY_PATH = resolve(HERE, "history.jsonl");

export interface AppendHistoryOptions {
  /** True when `git status --porcelain` reported pending changes. */
  dirty: boolean;
  /** Override the history file path (used by tests). */
  path?: string;
  /** Override the gold-set version. Defaults to `"v1"`. */
  goldSetVersion?: string;
  /** Override the timestamp (used by tests). */
  now?: () => Date;
}

/**
 * Appends one `HistoryRow` JSON line to `backend/eval/history.jsonl`.
 * Append-only: existing lines are preserved.
 *
 * `gitSha` and `dirty` are read by the CLI entrypoint and passed in;
 * `goldSetVersion` defaults to `"v1"`.
 */
export async function appendHistory(
  report: EvalReport,
  config: Record<string, unknown>,
  gitSha: string,
  options: AppendHistoryOptions,
): Promise<void> {
  const path = options.path ?? DEFAULT_HISTORY_PATH;
  const ts = (options.now?.() ?? new Date()).toISOString();

  const row: HistoryRow = {
    ts,
    gitSha,
    gitDirty: options.dirty,
    config,
    goldSetVersion: options.goldSetVersion ?? "v1",
    n: report.overall.n,
    metrics: report.overall,
    byCategory: report.byCategory,
  };

  await appendFile(path, JSON.stringify(row) + "\n", "utf8");
}

/**
 * Prints a plain-ASCII summary of `report` to stdout. Overall metrics first,
 * then a per-category breakdown. No third-party dependencies — keeps the
 * surface skinny and easy to eyeball in a terminal.
 */
export function printReport(report: EvalReport): void {
  printOverall(report.overall);
  console.log("");
  printByCategory(report.byCategory);
}

function printOverall(m: OverallMetrics): void {
  console.log("=== Eval results (overall) ===");
  console.log(`n              ${m.n}`);
  console.log(`recall@1       ${fmtRate(m.recallAt1)}`);
  console.log(`recall@5       ${fmtRate(m.recallAt5)}`);
  console.log(`recall@20      ${fmtRate(m.recallAt20)}`);
  console.log(`mrr            ${fmt3(m.mrr)}`);
  console.log(`category-hit   ${fmtRate(m.categoryHitRate)}`);
  console.log(`type-hit       ${fmtRate(m.typeHitRate)}`);
  console.log(`attr-overlap   ${fmt3(m.meanAttributeOverlap)}`);
  console.log(`p50 latency    ${m.p50LatencyMs} ms`);
  console.log(`p95 latency    ${m.p95LatencyMs} ms`);
  console.log(`tokens (total) ${m.totalTokens}`);
  console.log(`cost           $${fmt5(m.totalCostUsd)}`);
  console.log(
    `failures       missing=${m.failures.missingTarget} categoryMiss=${m.failures.categoryMiss} typeMiss=${m.failures.typeMiss}`,
  );
}

function printByCategory(byCategory: Record<string, OverallMetrics>): void {
  const categories = Object.keys(byCategory).sort();
  if (categories.length === 0) return;

  console.log("=== By category ===");
  // Header. Column widths chosen so a 15-char category fits.
  console.log(
    pad("category", 16) +
      pad("n", 4) +
      pad("r@1", 7) +
      pad("r@5", 7) +
      pad("r@20", 7) +
      pad("mrr", 7) +
      pad("attr", 7) +
      pad("$", 10),
  );
  for (const c of categories) {
    const m = byCategory[c];
    console.log(
      pad(c, 16) +
        pad(String(m.n), 4) +
        pad(fmtRate(m.recallAt1), 7) +
        pad(fmtRate(m.recallAt5), 7) +
        pad(fmtRate(m.recallAt20), 7) +
        pad(fmt3(m.mrr), 7) +
        pad(fmt3(m.meanAttributeOverlap), 7) +
        pad("$" + fmt5(m.totalCostUsd), 10),
    );
  }
}

function pad(s: string, width: number): string {
  if (s.length >= width) return s + " ";
  return s + " ".repeat(width - s.length);
}

function fmtRate(x: number): string {
  // Rate in [0, 1] as a 3-decimal number.
  return x.toFixed(3);
}

function fmt3(x: number): string {
  return x.toFixed(3);
}

function fmt5(x: number): string {
  return x.toFixed(5);
}
