import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient } from "mongodb";
import type { Product } from "shared/catalog";

import { searchCatalog } from "./search.js";

// `searchCatalog` accepts an optional injected `Collection` for tests so we
// don't have to tear down the module-level singleton between cases.

type SeedProduct = Omit<Product, "_id">;

const seed: SeedProduct[] = [
  {
    title: "Modern Leather Dining Bench",
    description: "Natural modern dining bench made from premium leather.",
    category: "Benches",
    type: "Dining Bench",
    price: 269.99,
    width: 135,
    height: 49,
    depth: 41,
  },
  {
    title: "Rustic Oak Storage Bench",
    description: "Handcrafted oak storage bench with hinged lid.",
    category: "Benches",
    type: "Storage Bench",
    price: 349.0,
    width: 120,
    height: 50,
    depth: 40,
  },
  {
    title: "Velvet Tufted Entryway Bench",
    description: "Plush velvet entryway bench with tufted seat.",
    category: "Benches",
    type: "Entryway Bench",
    price: 199.5,
    width: 110,
    height: 46,
    depth: 38,
  },
  {
    title: "Mid-century Walnut Dining Chair",
    description: "Walnut dining chair with leather seat and tapered legs.",
    category: "Chairs",
    type: "Dining Chair",
    price: 159.0,
    width: 50,
    height: 88,
    depth: 52,
  },
  {
    title: "Industrial Metal Bar Chair",
    description: "Steel-frame bar chair with reclaimed wood seat.",
    category: "Chairs",
    type: "Bar Chair",
    price: 129.0,
    width: 42,
    height: 105,
    depth: 42,
  },
  {
    title: "Velvet Accent Lounge Chair",
    description: "Plush velvet lounge chair, deep emerald green.",
    category: "Chairs",
    type: "Lounge Chair",
    price: 489.0,
    width: 78,
    height: 84,
    depth: 80,
  },
  {
    title: "Brass Pendant Ceiling Lamp",
    description: "Brass pendant lamp with frosted glass shade.",
    category: "Lighting",
    type: "Pendant Lamp",
    price: 219.0,
    width: 35,
    height: 40,
    depth: 35,
  },
  {
    title: "Marble Base Table Lamp",
    description: "Table lamp with white marble base and linen shade.",
    category: "Lighting",
    type: "Table Lamp",
    price: 139.0,
    width: 28,
    height: 52,
    depth: 28,
  },
  {
    title: "Industrial Floor Lamp",
    description: "Black metal floor lamp with adjustable arm.",
    category: "Lighting",
    type: "Floor Lamp",
    price: 179.0,
    width: 30,
    height: 165,
    depth: 30,
  },
  {
    title: "Wicker Outdoor Bench",
    description: "Weather-resistant wicker bench for patios.",
    category: "Benches",
    type: "Outdoor Bench",
    price: 299.0,
    width: 140,
    height: 48,
    depth: 45,
  },
];

describe("searchCatalog", () => {
  let server: MongoMemoryServer;
  let client: MongoClient;
  let dbName: string;
  let collectionName: string;

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    client = new MongoClient(server.getUri());
    await client.connect();
    dbName = "catalog_test";
    collectionName = "products";
  }, 120_000);

  afterAll(async () => {
    await client.close();
    await server.stop();
  });

  beforeEach(async () => {
    const col = client.db(dbName).collection(collectionName);
    await col.deleteMany({});
    await col.insertMany(seed.map((p) => ({ ...p })));
    // Match the live cluster: weighted text index on title (2) + description (1).
    await col.createIndex(
      { title: "text", description: "text" },
      { weights: { title: 2, description: 1 }, name: "title_text_description_text" },
    );
  });

  function collection() {
    return client.db(dbName).collection(collectionName);
  }

  it("returns products matching a text query, ordered by score", async () => {
    const results = await searchCatalog("leather dining", {}, 10, {
      collection: collection(),
    });

    expect(results.length).toBeGreaterThan(0);
    // The strongest match should be the leather dining bench.
    expect(results[0].title).toBe("Modern Leather Dining Bench");
    // No id leaks as ObjectId — boundary serialises to a hex string.
    expect(typeof results[0]._id).toBe("string");
  });

  it("narrows the result set when a category filter is supplied", async () => {
    const all = await searchCatalog("velvet", {}, 10, { collection: collection() });
    const narrowed = await searchCatalog(
      "velvet",
      { category: "Chairs" },
      10,
      { collection: collection() },
    );

    expect(all.some((p) => p.category === "Benches")).toBe(true);
    expect(narrowed.length).toBeGreaterThan(0);
    expect(narrowed.every((p) => p.category === "Chairs")).toBe(true);
    expect(narrowed.length).toBeLessThan(all.length);
  });

  it("honours the limit", async () => {
    const results = await searchCatalog("bench", {}, 2, { collection: collection() });
    expect(results.length).toBe(2);
  });

  it("returns [] when nothing matches instead of throwing", async () => {
    const results = await searchCatalog(
      "asdfghjklqwertyuiop",
      {},
      10,
      { collection: collection() },
    );
    expect(results).toEqual([]);
  });
});
