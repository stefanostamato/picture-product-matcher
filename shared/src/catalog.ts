// Wire shape of a product document in the read-only catalog Mongo collection.
// Derived from `scripts/explore-db.mjs` against the live cluster
// (db: catalog, collection: products, ~2500 docs). See
// `docs/catalog-schema.md` for the full discovery report.
//
// Treat this as immutable: the catalog DB is read-only.

export interface Product {
  /** Mongo ObjectId, serialized as a hex string at the wire boundary. */
  _id: string;
  /** Short marketing-style name, e.g. "Modern Leather Dining Bench". */
  title: string;
  /**
   * Long-form description. Style, material, and color are encoded as
   * leading prose (e.g. "Natural modern dining bench made from premium
   * leather…") rather than as structured fields.
   */
  description: string;
  /** One of 15 top-level categories (e.g. "Benches", "Sofas", "Lighting"). */
  category: string;
  /** Sub-category; one of 62 distinct values within a category. */
  type: string;
  /** Price in the catalog's currency, e.g. 269.99. */
  price: number;
  /** Physical dimensions in centimetres (integer). */
  width: number;
  height: number;
  depth: number;
}

/**
 * Closed list of `category` values observed in the catalog. Useful for
 * hard-filtering and as a constrained vocabulary for vision extraction.
 * Source of truth is the DB; keep this in sync with `docs/catalog-schema.md`.
 */
export const PRODUCT_CATEGORIES = [
  "Beds",
  "Benches",
  "Bookshelves",
  "Cabinets",
  "Chairs",
  "Coffee Tables",
  "Desks",
  "Dressers",
  "Lighting",
  "Nightstands",
  "Ottomans",
  "Sofas",
  "TV Stands",
  "Tables",
  "Wardrobes",
] as const;

export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];
