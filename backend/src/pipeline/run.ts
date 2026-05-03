import type { SearchResponse } from "shared/wire";
import type { Provider } from "../providers/index.js";
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

  const stopVision = metrics.stage("visionExtract");
  const extracted = await visionExtract(input, {
    provider: deps.provider,
    visionModel: config.visionModel,
  });
  stopVision();

  const stopQuery = metrics.stage("queryBuild");
  const built = queryBuild(extracted, input.prompt);
  stopQuery();

  const stopSearch = metrics.stage("catalogSearch");
  const candidates = await catalogSearch(built, {
    searchCatalog: deps.searchCatalog,
    topK: config.topK,
  });
  stopSearch();

  let results = candidates;
  if (config.rerank) {
    const stopRerank = metrics.stage("rerank");
    results = await rerank(candidates, extracted, { enabled: true });
    stopRerank();
  }

  const finalized = metrics.finalize();
  const lowConfidence = results.length === 0;

  return {
    results,
    meta: {
      latencyMs: finalized.latencyMs,
      stagesRan: finalized.stagesRan,
      extracted,
      ...(lowConfidence ? { lowConfidence: true } : {}),
    },
  };
}
