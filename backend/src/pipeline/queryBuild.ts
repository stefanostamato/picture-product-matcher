import { PRODUCT_CATEGORIES } from "shared/catalog";
import type { ExtractedAttributes } from "shared/wire";

export interface BuiltQuery {
  query: string;
  filters: { category?: string };
}

// Combine the model's description with the user prompt into a single text
// query. Whitespace is normalised so Mongo's `$text` operator sees clean
// tokens. The category filter is set only when the vision stage produced a
// value that maps to a canonical PRODUCT_CATEGORIES entry; otherwise we drop
// the filter so a stray model output (e.g. lowercase "sofa" vs canonical
// "Sofas") cannot zero out the result set.
export function queryBuild(
  extracted: ExtractedAttributes,
  userPrompt?: string,
): BuiltQuery {
  const parts = [extracted.description ?? ""];
  if (userPrompt && userPrompt.trim().length > 0) {
    parts.push(userPrompt);
  }
  const query = parts.join(" ").replace(/\s+/g, " ").trim();

  const filters: { category?: string } = {};
  const canonical = canonicalizeCategory(extracted.category);
  if (canonical) {
    filters.category = canonical;
  }

  return { query, filters };
}

function canonicalizeCategory(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) return undefined;
  return PRODUCT_CATEGORIES.find((c) => c.toLowerCase() === normalized);
}
