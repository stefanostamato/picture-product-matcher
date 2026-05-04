import type { SearchResponse } from "shared/wire";
import type { Provider } from "../providers/index.js";
import type { ProviderUsage } from "../providers/types.js";
import { priceFor } from "../providers/pricing.js";
import type { Config } from "../config/store.js";
import type { Metrics } from "../metrics/collector.js";
import type { SearchCatalogFn } from "./catalogSearch.js";
import { visionExtract } from "./visionExtract.js";
import { queryBuild } from "./queryBuild.js";
import { catalogSearch } from "./catalogSearch.js";
import { rerank } from "./rerank.js";

export interface RunPipelineInput {
  image: Buffer;
  mimeType: string;
  prompt?: string;
  apiKey: string;
}

export interface RunPipelineDeps {
  provider: Provider;
  searchCatalog: SearchCatalogFn;
  getConfig: () => Config;
  createMetrics: () => Metrics;
}

// Orchestrates the pipeline stages in the order described in AGENTS.md §5.
// All collaborators are injected — this module owns no singletons of its own
// so tests can swap each stage's dependency without touching globals.
export async function runPipeline(
  input: RunPipelineInput,
  deps: RunPipelineDeps,
): Promise<SearchResponse> {
  const config = deps.getConfig();
  const metrics = deps.createMetrics();
  const usages: ProviderUsage[] = [];

  const stopVision = metrics.stage("visionExtract");
  const visionResult = await visionExtract(input, {
    provider: deps.provider,
    visionModel: config.visionModel,
    visionPrompt: config.visionPrompt,
  });
  stopVision();
  const extracted = visionResult.extracted;
  usages.push(visionResult.usage);

  const stopQuery = metrics.stage("queryBuild");
  const built = queryBuild(extracted, input.prompt);
  stopQuery();

  const stopSearch = metrics.stage("catalogSearch");
  const search = await catalogSearch(built, {
    searchCatalog: deps.searchCatalog,
    topK: config.topK,
  });
  stopSearch();

  let results = search.products;
  if (config.rerank) {
    const stopRerank = metrics.stage("rerank");
    const rerankResult = await rerank(search.products, extracted, {
      enabled: true,
      provider: deps.provider,
      apiKey: input.apiKey,
      image: input.image,
      mimeType: input.mimeType,
      model: config.rerankModel,
      systemPrompt: config.rerankPrompt,
      topN: config.rerankTopN,
    });
    stopRerank();
    results = rerankResult.products;
    if (rerankResult.usage) {
      usages.push(rerankResult.usage);
    }
  }

  const finalized = metrics.finalize();
  const lowConfidence = results.length === 0;
  const tokens = sumTokens(usages);
  const costUsd = sumCost(usages);

  return {
    results,
    meta: {
      latencyMs: finalized.latencyMs,
      stagesRan: finalized.stagesRan,
      extracted,
      tokens,
      costUsd,
      topResults: search.topRaw,
      ...(lowConfidence ? { lowConfidence: true } : {}),
    },
  };
}

function sumTokens(usages: ProviderUsage[]): {
  prompt: number;
  completion: number;
  total: number;
} {
  let prompt = 0;
  let completion = 0;
  for (const u of usages) {
    prompt += u.promptTokens;
    completion += u.completionTokens;
  }
  return { prompt, completion, total: prompt + completion };
}

function sumCost(usages: ProviderUsage[]): number {
  let total = 0;
  for (const u of usages) {
    total += priceFor(u.model, u.promptTokens, u.completionTokens);
  }
  return total;
}
