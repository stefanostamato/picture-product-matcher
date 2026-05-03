import type { Product } from "shared/catalog";
import type { ExtractedAttributes } from "shared/wire";

export interface RerankDeps {
  enabled: boolean;
}

// Stub passthrough. The full LLM rerank lives behind this seam in a later
// task; today we keep the shape so the orchestrator can call it and admins
// can flip the flag without code changes.
export async function rerank(
  results: Product[],
  _attributes: ExtractedAttributes,
  _deps: RerankDeps,
): Promise<Product[]> {
  return results;
}
