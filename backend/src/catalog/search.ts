import type { Collection, Document, Filter } from "mongodb";
import type { Product } from "shared/catalog";

import { getCatalogCollection } from "./client.js";

// Query the catalog with Mongo's `$text` index, ranked by `textScore`.
//
// `searchCatalog` accepts an optional injected `Collection` so tests can swap
// in `mongodb-memory-server` without touching the production singleton. In
// production callers omit it and the singleton resolves itself.

export type CatalogFilters = {
  category?: string;
};

export type SearchCatalogDeps = {
  collection?: Collection;
};

export async function searchCatalog(
  query: string,
  filters: CatalogFilters,
  limit: number,
  deps: SearchCatalogDeps = {},
): Promise<Product[]> {
  const collection = deps.collection ?? (await getCatalogCollection());

  const filter: Filter<Document> = { $text: { $search: query } };
  if (filters.category && filters.category.length > 0) {
    filter.category = filters.category;
  }

  const docs = await collection
    .find(filter, { projection: { score: { $meta: "textScore" } } })
    .sort({ score: { $meta: "textScore" } })
    .limit(limit)
    .toArray();

  return docs.map(toProduct);
}

function toProduct(doc: Record<string, unknown>): Product {
  const id = doc._id;
  const idString =
    id && typeof (id as { toHexString?: () => string }).toHexString === "function"
      ? (id as { toHexString: () => string }).toHexString()
      : String(id);
  return {
    _id: idString,
    title: doc.title as string,
    description: doc.description as string,
    category: doc.category as string,
    type: doc.type as string,
    price: doc.price as number,
    width: doc.width as number,
    height: doc.height as number,
    depth: doc.depth as number,
  };
}
