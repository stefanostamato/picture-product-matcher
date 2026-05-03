// One-off Mongo catalog discovery script.
// Reads `DB_URL` from `.env`, samples documents, lists indexes, prints a
// field-name -> observed-types table. Writes nothing to the DB.
//
// Run: node --env-file=.env scripts/explore-db.mjs
//
// Optional env:
//   DB_NAME          — override database name (default: parsed from DB_URL pathname)
//   COLLECTION_NAME  — override collection (default: auto-detect single non-system collection)
//   SAMPLE_SIZE      — sample size (default: 5)

import { MongoClient } from "mongodb";

const uri = process.env.DB_URL;
if (!uri) {
  console.error("DB_URL is not set. Did you load .env? Try: node --env-file=.env scripts/explore-db.mjs");
  process.exit(1);
}

const sampleSize = Number(process.env.SAMPLE_SIZE ?? 5);
const dbNameOverride = process.env.DB_NAME;
const collectionOverride = process.env.COLLECTION_NAME;

const dbNameFromUri = (() => {
  try {
    const u = new URL(uri);
    const path = u.pathname.replace(/^\//, "");
    return path || undefined;
  } catch {
    return undefined;
  }
})();

function classifyValue(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) {
    if (value.length === 0) return "array<empty>";
    const inner = new Set(value.map((v) => classifyValue(v)));
    return `array<${[...inner].join("|")}>`;
  }
  const t = typeof value;
  if (t === "object") {
    if (value instanceof Date) return "date";
    if (value._bsontype === "ObjectId" || value.constructor?.name === "ObjectId") return "ObjectId";
    return "object";
  }
  return t;
}

function mergeFieldTypes(field, observed) {
  const set = field.types;
  const split = observed.split("|");
  for (const s of split) set.add(s);
  field.count += 1;
}

async function main() {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 });
  await client.connect();
  try {
    const dbName = dbNameOverride ?? dbNameFromUri;
    if (!dbName) {
      console.error("Could not determine DB name from DB_URL pathname. Set DB_NAME explicitly.");
      process.exit(1);
    }
    const db = client.db(dbName);

    const collections = (await db.listCollections().toArray())
      .map((c) => c.name)
      .filter((n) => !n.startsWith("system."));

    console.log(`# Database: ${dbName}`);
    console.log(`# Collections: ${collections.join(", ")}`);

    let collectionName = collectionOverride;
    if (!collectionName) {
      if (collections.length === 1) {
        collectionName = collections[0];
      } else {
        console.error(`Multiple collections found; set COLLECTION_NAME. Found: ${collections.join(", ")}`);
        process.exit(1);
      }
    }
    const coll = db.collection(collectionName);
    console.log(`# Using collection: ${collectionName}`);

    const stats = {
      count: await coll.estimatedDocumentCount(),
    };
    console.log(`# Estimated document count: ${stats.count}`);

    // Indexes
    const indexes = await coll.indexes();
    console.log("\n## Indexes");
    for (const idx of indexes) {
      const { name, key, weights, default_language, language_override, ...rest } = idx;
      const summary = {
        name,
        key,
        ...(weights ? { weights } : {}),
        ...(default_language ? { default_language } : {}),
        ...(language_override ? { language_override } : {}),
      };
      console.log(JSON.stringify(summary));
      if (Object.keys(rest).filter((k) => !["v", "ns"].includes(k)).length > 0) {
        // fall through silently — we keep output compact
      }
    }

    // Sample
    const sampled = await coll.aggregate([{ $sample: { size: sampleSize } }]).toArray();
    console.log(`\n## Sample (${sampled.length} of ${sampleSize} requested)`);
    for (const doc of sampled) {
      // Print compact: only keys, with truncated string values
      const compact = {};
      for (const [k, v] of Object.entries(doc)) {
        if (typeof v === "string" && v.length > 80) compact[k] = v.slice(0, 80) + "…";
        else compact[k] = v;
      }
      console.log(JSON.stringify(compact));
    }

    // Field-type table aggregated over the sample
    const fields = new Map();
    for (const doc of sampled) {
      for (const [k, v] of Object.entries(doc)) {
        if (!fields.has(k)) fields.set(k, { types: new Set(), count: 0 });
        mergeFieldTypes(fields.get(k), classifyValue(v));
      }
    }
    console.log("\n## Field types (from sample)");
    console.log("field\ttypes\tpresent_in_sample");
    for (const [name, info] of [...fields.entries()].sort()) {
      console.log(`${name}\t${[...info.types].join("|")}\t${info.count}/${sampled.length}`);
    }

    // Cardinality probe for likely categorical fields.
    const categoricalCandidates = ["category", "type", "style", "material", "color"];
    console.log("\n## Distinct values for likely categorical fields (capped)");
    for (const f of categoricalCandidates) {
      try {
        const values = await coll.distinct(f);
        const head = values.slice(0, 30);
        console.log(`${f} (${values.length}): ${JSON.stringify(head)}${values.length > head.length ? " …" : ""}`);
      } catch {
        // field may not exist; skip
      }
    }
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error("explore-db failed:", err.message);
  process.exit(1);
});
