import type { SearchResponse } from "shared/wire";
import type { Config } from "../src/config/store.js";
import {
  aggregate,
  aggregateByCategory,
  attributeOverlap,
  categoryHit,
  recallAtK,
  reciprocalRank,
  typeHit,
} from "./scorer.js";
import type { EvalReport, EvalRow, GoldItem } from "./types.js";

/**
 * One gold-set entry as the runner consumes it: the structured `GoldItem`
 * plus the bytes of its paired image. `loadGold` is responsible for reading
 * both off disk so the runner stays purely orchestrational.
 */
export interface LoadedGoldItem {
  item: GoldItem;
  image: Buffer;
  mimeType: string;
}

/**
 * Minimal subset of `runPipeline`'s signature we depend on. Re-declared here
 * rather than imported so the runner can be unit-tested without dragging in
 * pipeline implementations.
 */
export type RunPipelineFn = (input: {
  image: Buffer;
  mimeType: string;
  apiKey: string;
  prompt?: string;
}) => Promise<SearchResponse>;

export interface RunEvalDeps {
  runPipeline: RunPipelineFn;
  loadGold: () => Promise<LoadedGoldItem[]>;
  getConfig: () => Config;
  apiKey: string;
  /** Pace between gold items (ms). Smooths sequential bursts so we don't
   * trigger per-minute rate or token limits on the provider. The provider
   * adapter already retries individual 429s; pacing is a complementary
   * measure for sustained throughput. Default is intentionally conservative
   * (20s) so the eval completes on tier-1 OpenAI accounts where image-heavy
   * `gpt-4o-mini` calls saturate the TPM budget quickly. Lower this if your
   * account has higher limits and you want faster runs. Tests should pass 0. */
  paceMs?: number;
}

const DEFAULT_PACE_MS = 20_000;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Drives `runPipeline` over every gold item, scores each response with the
 * pure functions in `scorer.ts`, and assembles an `EvalReport`. All I/O is
 * injected so this module is unit-testable without OpenAI or Mongo.
 */
export async function runEval(deps: RunEvalDeps): Promise<EvalReport> {
  const goldItems = await deps.loadGold();
  const rows: EvalRow[] = [];
  const paceMs = deps.paceMs ?? DEFAULT_PACE_MS;

  for (let i = 0; i < goldItems.length; i++) {
    const loaded = goldItems[i];
    const response = await deps.runPipeline({
      image: loaded.image,
      mimeType: loaded.mimeType,
      apiKey: deps.apiKey,
    });

    rows.push(scoreRow(loaded.item, response));

    if (paceMs > 0 && i < goldItems.length - 1) await sleep(paceMs);
  }

  return {
    overall: aggregate(rows),
    byCategory: aggregateByCategory(rows),
    runs: rows,
  };
}

function scoreRow(item: GoldItem, response: SearchResponse): EvalRow {
  const results = response.results;
  return {
    goldItem: item,
    response,
    scores: {
      recallAt1: recallAtK(item.productId, results, 1),
      recallAt5: recallAtK(item.productId, results, 5),
      recallAt20: recallAtK(item.productId, results, 20),
      reciprocalRank: reciprocalRank(item.productId, results),
      categoryHit: categoryHit(response.meta.extracted, item),
      typeHit: typeHit(response.meta.extracted, item),
      attributeOverlap: attributeOverlap(response.meta.extracted, item),
    },
  };
}
