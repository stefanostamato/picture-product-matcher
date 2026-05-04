import type { Product } from "shared/catalog";
import type { ExtractedAttributes } from "shared/wire";
import type { EvalReport, EvalRow, GoldItem, OverallMetrics } from "./types";

/**
 * 1 if `targetId` appears within the first `k` results, else 0.
 */
export function recallAtK(targetId: string, results: Product[], k: number): 0 | 1 {
  const limit = Math.min(k, results.length);
  for (let i = 0; i < limit; i++) {
    if (results[i]._id === targetId) return 1;
  }
  return 0;
}

/**
 * 1 / rank of the target (1-based), or 0 if not present.
 */
export function reciprocalRank(targetId: string, results: Product[]): number {
  for (let i = 0; i < results.length; i++) {
    if (results[i]._id === targetId) return 1 / (i + 1);
  }
  return 0;
}

const eq = (a: string | undefined, b: string | undefined): boolean => {
  if (!a || !b) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
};

export function categoryHit(extracted: ExtractedAttributes, gold: GoldItem): boolean {
  return eq(extracted.category, gold.category);
}

export function typeHit(extracted: ExtractedAttributes, gold: GoldItem): boolean {
  return eq(extracted.type, gold.type);
}

const tokenize = (values: Array<string | undefined>): Set<string> => {
  const out = new Set<string>();
  for (const v of values) {
    if (!v) continue;
    const norm = v.trim().toLowerCase();
    if (norm) out.add(norm);
  }
  return out;
};

const tokenizeArr = (values: string[]): Set<string> => {
  const out = new Set<string>();
  for (const v of values) {
    const norm = v.trim().toLowerCase();
    if (norm) out.add(norm);
  }
  return out;
};

/**
 * Jaccard overlap on the union of color/material/style tokens between the
 * extracted attributes (single string per axis) and the gold item (string[]
 * per axis). Returns 0 when both sides have no tokens.
 */
export function attributeOverlap(extracted: ExtractedAttributes, gold: GoldItem): number {
  const left = tokenize([extracted.color, extracted.material, extracted.style]);
  const right = new Set<string>([
    ...tokenizeArr(gold.color),
    ...tokenizeArr(gold.material),
    ...tokenizeArr(gold.style),
  ]);

  if (left.size === 0 && right.size === 0) return 0;

  let intersection = 0;
  for (const t of left) {
    if (right.has(t)) intersection++;
  }
  const union = left.size + right.size - intersection;
  if (union === 0) return 0;
  return intersection / union;
}

/**
 * Nearest-rank percentile for a set of numeric samples. `p` is in [0, 1].
 * Returns 0 for an empty input.
 */
const percentile = (values: number[], p: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil(p * sorted.length);
  const idx = Math.max(0, Math.min(sorted.length - 1, rank - 1));
  return sorted[idx];
};

const sum = (xs: number[]): number => xs.reduce((acc, x) => acc + x, 0);

const mean = (xs: number[]): number => (xs.length === 0 ? 0 : sum(xs) / xs.length);

const aggregateRows = (rows: EvalRow[]): OverallMetrics => {
  const n = rows.length;
  if (n === 0) {
    return {
      n: 0,
      recallAt1: 0,
      recallAt5: 0,
      recallAt20: 0,
      mrr: 0,
      categoryHitRate: 0,
      typeHitRate: 0,
      meanAttributeOverlap: 0,
      p50LatencyMs: 0,
      p95LatencyMs: 0,
      totalTokens: 0,
      totalCostUsd: 0,
      failures: { missingTarget: 0, categoryMiss: 0, typeMiss: 0 },
    };
  }

  const recall1 = mean(rows.map((r) => r.scores.recallAt1));
  const recall5 = mean(rows.map((r) => r.scores.recallAt5));
  const recall20 = mean(rows.map((r) => r.scores.recallAt20));
  const mrr = mean(rows.map((r) => r.scores.reciprocalRank));
  const catRate = mean(rows.map((r) => (r.scores.categoryHit ? 1 : 0)));
  const typeRate = mean(rows.map((r) => (r.scores.typeHit ? 1 : 0)));
  const attrMean = mean(rows.map((r) => r.scores.attributeOverlap));

  const latencies = rows.map((r) => r.response.meta.latencyMs);
  const p50 = percentile(latencies, 0.5);
  const p95 = percentile(latencies, 0.95);

  const totalTokens = sum(rows.map((r) => r.response.meta.tokens?.total ?? 0));
  const totalCostUsd = sum(rows.map((r) => r.response.meta.costUsd ?? 0));

  const missingTarget = rows.filter((r) => r.scores.reciprocalRank === 0).length;
  const categoryMiss = rows.filter((r) => !r.scores.categoryHit).length;
  const typeMiss = rows.filter((r) => !r.scores.typeHit).length;

  return {
    n,
    recallAt1: recall1,
    recallAt5: recall5,
    recallAt20: recall20,
    mrr,
    categoryHitRate: catRate,
    typeHitRate: typeRate,
    meanAttributeOverlap: attrMean,
    p50LatencyMs: p50,
    p95LatencyMs: p95,
    totalTokens,
    totalCostUsd,
    failures: { missingTarget, categoryMiss, typeMiss },
  };
};

/**
 * Aggregate metrics across every row.
 */
export function aggregate(rows: EvalRow[]): EvalReport["overall"] {
  return aggregateRows(rows);
}

/**
 * Bucket rows by `goldItem.category` and aggregate within each bucket.
 */
export function aggregateByCategory(rows: EvalRow[]): EvalReport["byCategory"] {
  const buckets = new Map<string, EvalRow[]>();
  for (const row of rows) {
    const key = row.goldItem.category;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(row);
    else buckets.set(key, [row]);
  }
  const out: Record<string, OverallMetrics> = {};
  for (const [key, bucket] of buckets) {
    out[key] = aggregateRows(bucket);
  }
  return out;
}
