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

// Thin wrapper so the orchestrator can compose stages uniformly without
// knowing the catalog module's argument order.
export async function catalogSearch(
  input: CatalogSearchInput,
  deps: CatalogSearchDeps,
): Promise<Product[]> {
  return deps.searchCatalog(input.query, input.filters, deps.topK);
}
