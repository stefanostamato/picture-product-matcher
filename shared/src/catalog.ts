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

// Closed list of `type` values per category, derived from the live catalog
// via `scripts/explore-db.mjs`. 62 values total. Used as a constrained
// vocabulary for vision extraction so the model can't invent type strings
// the catalog doesn't have.
export const PRODUCT_TYPES_BY_CATEGORY: Record<ProductCategory, readonly string[]> = {
  Beds: ["Bunk Bed", "Canopy Bed", "Daybed", "Platform Bed", "Storage Bed"],
  Benches: ["Dining Bench", "Entryway Bench", "Garden Bench", "Storage Bench"],
  Bookshelves: ["Corner Bookshelf", "Ladder Shelf", "Tall Bookshelf", "Wide Bookshelf"],
  Cabinets: ["Bar Cabinet", "Display Cabinet", "Filing Cabinet", "Storage Cabinet"],
  Chairs: ["Accent Chair", "Armchair", "Dining Chair", "Recliner", "Rocking Chair"],
  "Coffee Tables": [
    "Lift-Top Coffee Table",
    "Nesting Coffee Table",
    "Rectangular Coffee Table",
    "Round Coffee Table",
  ],
  Desks: ["Executive Desk", "L-Shaped Desk", "Standing Desk", "Writing Desk"],
  Dressers: ["Double Dresser", "Tall Dresser", "Wide Dresser"],
  Lighting: ["Chandelier", "Desk Lamp", "Floor Lamp", "Pendant Light", "Table Lamp"],
  Nightstands: ["Open Shelf Nightstand", "Single Drawer Nightstand", "Two Drawer Nightstand"],
  Ottomans: ["Bench Ottoman", "Pouf", "Storage Ottoman", "Tufted Ottoman"],
  Sofas: ["Chesterfield Sofa", "Futon", "Loveseat", "Sectional Sofa", "Sleeper Sofa"],
  "TV Stands": [
    "Corner TV Stand",
    "Entertainment Center",
    "Floating TV Stand",
    "Low Profile TV Stand",
  ],
  Tables: ["Console Table", "Dining Table", "Extendable Table", "Side Table"],
  Wardrobes: ["Corner Wardrobe", "Hinged Door Wardrobe", "Open Wardrobe", "Sliding Door Wardrobe"],
} as const;

export const PRODUCT_TYPES = Object.values(PRODUCT_TYPES_BY_CATEGORY).flat();
