import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { getCatalogCollection, closeCatalogClient } from "../../src/catalog/client.js";
import { PRODUCT_CATEGORIES } from "shared/catalog";

// Stratified sampler for the eval gold set.
//
// Goal (plans/eval-harness.md, Task E5): pick `perCategory` products per
// category, preferring different `type` values. Falls back to same-type when
// a category has fewer types than requested. The pure function
// `pickStratified` is exported so it can be unit-tested without I/O.
//
// Usage (after `npm run gold:sample`):
//   - reads catalog via the existing `getCatalogCollection` singleton
//   - writes `backend/eval/fixtures/gold/_sample.json`

export interface RawProduct {
  productId: string;
  category: string;
  type: string;
  title: string;
  description: string;
}

export type Sample = RawProduct;

export interface PickStratifiedOptions {
  /** Deterministic shuffle seed; same seed → same output. */
  seed: number;
}

export function pickStratified(
  products: readonly RawProduct[],
  perCategory: number,
  options: PickStratifiedOptions,
): Sample[] {
  const byCategory = new Map<string, RawProduct[]>();
  for (const p of products) {
    const bucket = byCategory.get(p.category) ?? [];
    bucket.push(p);
    byCategory.set(p.category, bucket);
  }

  const out: Sample[] = [];
  // Iterate categories in a stable order so the result is deterministic across
  // runs even when the input array's category-grouping order varies.
  const categories = Array.from(byCategory.keys()).sort();

  for (const category of categories) {
    const bucket = byCategory.get(category)!;
    const rng = mulberry32(hashSeed(options.seed, category));
    const shuffled = stableShuffle(bucket, rng);
    out.push(...pickFromBucket(shuffled, perCategory));
  }
  return out;
}

function pickFromBucket(shuffled: RawProduct[], perCategory: number): RawProduct[] {
  // First pass: take one product per distinct type, in shuffled order.
  const seenTypes = new Set<string>();
  const distinct: RawProduct[] = [];
  for (const p of shuffled) {
    if (distinct.length >= perCategory) break;
    if (seenTypes.has(p.type)) continue;
    seenTypes.add(p.type);
    distinct.push(p);
  }
  if (distinct.length === perCategory) return distinct;

  // Fallback: top up with whatever remains, preserving the shuffled order.
  const chosen = new Set(distinct.map((p) => p.productId));
  for (const p of shuffled) {
    if (distinct.length >= perCategory) break;
    if (chosen.has(p.productId)) continue;
    distinct.push(p);
    chosen.add(p.productId);
  }
  return distinct;
}

// Deterministic, side-effect-free PRNG. We avoid Math.random so tests can pin
// a seed and assert exact equality across runs.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(seed: number, category: string): number {
  let h = seed >>> 0;
  for (let i = 0; i < category.length; i++) {
    h = Math.imul(h ^ category.charCodeAt(i), 16777619) >>> 0;
  }
  return h;
}

function stableShuffle<T>(items: readonly T[], rng: () => number): T[] {
  const arr = items.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

// ---------- CLI entry ----------

const PER_CATEGORY = 2;
const DEFAULT_SEED = 20251201;

async function fetchProducts(): Promise<RawProduct[]> {
  const collection = await getCatalogCollection();
  const docs = await collection
    .find(
      { category: { $in: [...PRODUCT_CATEGORIES] } },
      { projection: { _id: 1, category: 1, type: 1, title: 1, description: 1 } },
    )
    .toArray();

  return docs.map((doc) => ({
    productId: idToString(doc._id),
    category: String(doc.category ?? ""),
    type: String(doc.type ?? ""),
    title: String(doc.title ?? ""),
    description: String(doc.description ?? ""),
  }));
}

function idToString(id: unknown): string {
  if (id && typeof (id as { toHexString?: () => string }).toHexString === "function") {
    return (id as { toHexString: () => string }).toHexString();
  }
  return String(id);
}

async function main(): Promise<void> {
  const seedRaw = process.env.GOLD_SAMPLE_SEED;
  const seed = seedRaw ? Number.parseInt(seedRaw, 10) : DEFAULT_SEED;
  if (!Number.isFinite(seed)) {
    throw new Error(`GOLD_SAMPLE_SEED must be an integer, got: ${seedRaw}`);
  }

  if (!process.env.DB_URL) {
    throw new Error(
      "DB_URL is not set; cannot sample products. See .env.example.",
    );
  }

  const all = await fetchProducts();
  const samples = pickStratified(all, PER_CATEGORY, { seed });

  const here = dirname(fileURLToPath(import.meta.url));
  const outPath = resolve(here, "..", "fixtures", "gold", "_sample.json");
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, JSON.stringify(samples, null, 2) + "\n", "utf8");

  // eslint-disable-next-line no-console
  console.log(
    `Wrote ${samples.length} samples to ${outPath} (seed=${seed}, perCategory=${PER_CATEGORY}).`,
  );

  await closeCatalogClient();
}

const isDirectRun =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("sample-products.ts");

if (isDirectRun) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
