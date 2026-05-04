import type { SearchResponse } from "shared/wire";

/**
 * One row in the frozen gold set. Each fixture corresponds to a synthetic
 * room photo generated for a specific catalog product (`productId` is the
 * ground-truth target the pipeline should retrieve). The `color`, `material`,
 * and `style` arrays hold attribute tokens extracted from the source product
 * description so the scorer can measure attribute-level recall.
 */
export interface GoldItem {
  productId: string;
  category: string;
  type: string;
  title: string;
  description: string;
  color: string[];
  material: string[];
  style: string[];
}

/**
 * Per-item scoring output. `response` is the raw `SearchResponse` returned
 * by `runPipeline` for the gold image; `scores` are the mechanical metrics
 * derived from it by the scorer.
 */
export interface EvalRow {
  goldItem: GoldItem;
  response: SearchResponse;
  scores: {
    /** 1 if target product is in the top 1 results, else 0. */
    recallAt1: 0 | 1;
    /** 1 if target product is in the top 5 results, else 0. */
    recallAt5: 0 | 1;
    /** 1 if target product is in the top 20 results, else 0. */
    recallAt20: 0 | 1;
    /** 1 / rank of the target, or 0 if absent. */
    reciprocalRank: number;
    /** True when the extracted category matches the gold category (case-insensitive). */
    categoryHit: boolean;
    /** True when the extracted type matches the gold type (case-insensitive). */
    typeHit: boolean;
    /** Jaccard overlap on the union of color/material/style tokens. */
    attributeOverlap: number;
  };
}

/**
 * Aggregate metrics produced by the scorer for a set of `EvalRow`s.
 */
export interface OverallMetrics {
  /** Number of rows aggregated. */
  n: number;
  recallAt1: number;
  recallAt5: number;
  recallAt20: number;
  mrr: number;
  categoryHitRate: number;
  typeHitRate: number;
  meanAttributeOverlap: number;
  /** Median pipeline latency, ms. */
  p50LatencyMs: number;
  /** 95th-percentile pipeline latency, ms (nearest-rank). */
  p95LatencyMs: number;
  totalTokens: number;
  totalCostUsd: number;
  failures: {
    /** Rows where the target product was not in `results` at all. */
    missingTarget: number;
    /** Rows where the extracted category did not match the gold category. */
    categoryMiss: number;
    /** Rows where the extracted type did not match the gold type. */
    typeMiss: number;
  };
}

/**
 * Top-level scorer output. `byCategory` is keyed by `GoldItem.category`.
 * `runs` preserves the per-row detail for downstream printers / writers.
 */
export interface EvalReport {
  overall: OverallMetrics;
  byCategory: Record<string, OverallMetrics>;
  runs: EvalRow[];
}

/**
 * One line in `backend/eval/history.jsonl`. Append-only — every eval run
 * adds exactly one of these. Fields are flat so the file can be loaded into
 * a notebook or admin UI without joining.
 */
export interface HistoryRow {
  /** ISO-8601 UTC timestamp of when the eval run finished. */
  ts: string;
  /** `git rev-parse HEAD` at run time. */
  gitSha: string;
  /** True when `git status --porcelain` reported any pending changes. */
  gitDirty: boolean;
  /** Snapshot of admin-tunable pipeline config used for the run. */
  config: Record<string, unknown>;
  /** Identifier of the gold-set version (e.g. `"v1"`). */
  goldSetVersion: string;
  /** Number of gold items scored. */
  n: number;
  /** Aggregate metrics across all gold items. */
  metrics: OverallMetrics;
  /** Per-category breakdown of the same metrics. */
  byCategory: Record<string, OverallMetrics>;
}
