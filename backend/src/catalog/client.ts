import { MongoClient, type Collection, type Db } from "mongodb";

// Single source of truth for the Mongo connection. AGENTS.md §5: only the
// catalog module imports `mongodb`. Anything in the rest of the backend that
// needs catalog data calls into `searchCatalog` (or a sibling), never opens
// its own client.

type Singleton = {
  client: MongoClient;
  db: Db;
  collection: Collection;
};

let instance: Singleton | null = null;
let connecting: Promise<Singleton> | null = null;

function readEnv() {
  const uri = process.env.DB_URL;
  if (!uri) {
    throw new Error(
      "DB_URL is not set; cannot connect to the catalog. See .env.example.",
    );
  }
  const dbName = process.env.DB_NAME ?? "catalog";
  const collectionName = process.env.COLLECTION_NAME ?? "products";
  return { uri, dbName, collectionName };
}

async function connect(): Promise<Singleton> {
  const { uri, dbName, collectionName } = readEnv();
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);
  const collection = db.collection(collectionName);
  return { client, db, collection };
}

export async function getCatalogCollection(): Promise<Collection> {
  if (instance) return instance.collection;
  if (!connecting) {
    connecting = connect()
      .then((s) => {
        instance = s;
        return s;
      })
      .catch((err) => {
        connecting = null;
        throw err;
      });
  }
  const s = await connecting;
  return s.collection;
}

export async function closeCatalogClient(): Promise<void> {
  const s = instance;
  instance = null;
  connecting = null;
  if (s) {
    await s.client.close();
  }
}
