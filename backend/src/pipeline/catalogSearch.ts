import type { Product } from "shared/catalog";
import type { CatalogFilters } from "../catalog/index.js";

export type SearchCatalogFn = (
  query: string,
  filters: CatalogFilters,
  limit: number,
) => Promise<Product[]>;

export interface CatalogSearchInput {
  query: string;
  filters: CatalogFilters;
}

export interface CatalogSearchDeps {
  searchCatalog: SearchCatalogFn;
  topK: number;
}

export interface CatalogSearchResult {
  /** Catalog hits, already ranked descending. */
  products: Product[];
  /**
   * Top 3 raw results before any downstream slicing or rerank, surfaced for
   * the dev-only diag panel and the eval harness. The underlying catalog query
   * does not currently expose `textScore` per-document, so we synthesize a
   * descending positional score that the diag panel can render as-is.
   * Replace with real scores when the catalog layer starts returning them.
   */
  topRaw: Array<{ productId: string; score: number }>;
}

const TOP_RAW_LIMIT = 3;

// Thin wrapper so the orchestrator can compose stages uniformly without
// knowing the catalog module's argument order. Also captures the top-3 raw
// results before any further pipeline slicing (rerank, etc.).
export async function catalogSearch(
  input: CatalogSearchInput,
  deps: CatalogSearchDeps,
): Promise<CatalogSearchResult> {
  const products = await deps.searchCatalog(input.query, input.filters, deps.topK);
  const topRaw = products
    .slice(0, TOP_RAW_LIMIT)
    .map((p, index, arr) => ({
      productId: p._id,
      score: (arr.length - index) / arr.length,
    }));
  return { products, topRaw };
}
