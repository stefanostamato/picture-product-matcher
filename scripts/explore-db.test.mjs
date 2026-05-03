// Self-contained test for T0 deliverables.
//
// Run: node --test scripts/explore-db.test.mjs
//
// Covers:
//   1. `Product` type in `shared/src/catalog.ts` compiles against a fixture
//      document via `tsc --noEmit` (uses npx, requires network on first run).
//   2. `.env.example` mirrors the same keys as the user's `.env` (with
//      placeholder values that are NOT the real values).
//   3. `docs/catalog-schema.md` exists and references the discovered fields,
//      indexes, and collection.
//   4. The discovery script exists and is executable as ESM.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

const envPath = join(repoRoot, ".env");
const envExamplePath = join(repoRoot, ".env.example");
const catalogTypePath = join(repoRoot, "shared/src/catalog.ts");
const schemaDocPath = join(repoRoot, "docs/catalog-schema.md");
const scriptPath = join(repoRoot, "scripts/explore-db.mjs");
const readmePath = join(repoRoot, "README.md");

function parseEnv(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    out[key] = value;
  }
  return out;
}

test(".env.example exists and mirrors .env keys with placeholder values", () => {
  assert.ok(existsSync(envPath), ".env should exist (created by user)");
  assert.ok(existsSync(envExamplePath), ".env.example should exist");

  const realEnv = parseEnv(readFileSync(envPath, "utf8"));
  const exampleEnv = parseEnv(readFileSync(envExamplePath, "utf8"));

  for (const key of Object.keys(realEnv)) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(exampleEnv, key),
      `.env.example missing key '${key}' that exists in .env`,
    );
    assert.notEqual(
      exampleEnv[key],
      realEnv[key],
      `.env.example must NOT contain the real value for '${key}'`,
    );
  }

  // The known shape: DB_URL must be present and use a placeholder host.
  assert.ok(exampleEnv.DB_URL, ".env.example must declare DB_URL");
  assert.match(
    exampleEnv.DB_URL,
    /USER|PASSWORD|CLUSTER|EXAMPLE/i,
    ".env.example DB_URL should be an obvious placeholder",
  );
});

test("docs/catalog-schema.md exists and references the discovered shape", () => {
  assert.ok(existsSync(schemaDocPath), "docs/catalog-schema.md should exist");
  const md = readFileSync(schemaDocPath, "utf8");
  for (const needle of [
    "products",
    "title",
    "description",
    "category",
    "type",
    "price",
    "title_text_description_text",
    "category_1_type_1_price_1",
  ]) {
    assert.ok(md.includes(needle), `schema doc should mention '${needle}'`);
  }
});

test("README.md has a 'Database setup' section", () => {
  assert.ok(existsSync(readmePath), "README.md should exist");
  const md = readFileSync(readmePath, "utf8");
  assert.match(md, /##\s+Database setup/i, "README must include a 'Database setup' section");
  assert.ok(md.includes("DB_URL"), "README setup section should mention DB_URL");
});

test("scripts/explore-db.mjs exists and is valid ESM (parses)", () => {
  assert.ok(existsSync(scriptPath), "scripts/explore-db.mjs should exist");
  // Syntax-check by asking node to parse it without executing.
  execFileSync(process.execPath, ["--check", scriptPath], { stdio: "pipe" });
});

test("Product type compiles against a representative fixture document", { timeout: 120000 }, () => {
  assert.ok(existsSync(catalogTypePath), "shared/src/catalog.ts should exist");

  const tmp = mkdtempSync(join(tmpdir(), "ppm-t0-"));
  try {
    // Copy the type file in alongside a fixture importer so tsc only sees these two.
    const localCatalog = join(tmp, "catalog.ts");
    writeFileSync(localCatalog, readFileSync(catalogTypePath, "utf8"));

    const fixture = `
import type { Product } from "./catalog";

const valid: Product = {
  _id: "6989d492d0ca8969ace9fe2b",
  title: "Modern Leather Dining Bench",
  description: "Natural modern dining bench made from premium leather.",
  category: "Benches",
  type: "Dining Bench",
  price: 269.99,
  width: 135,
  height: 49,
  depth: 41,
};

// Field access must be typed.
const t: string = valid.title;
const c: string = valid.category;
const p: number = valid.price;
void t; void c; void p;
`;
    writeFileSync(join(tmp, "fixture.ts"), fixture);

    const tsconfig = {
      compilerOptions: {
        target: "ES2022",
        module: "ES2022",
        moduleResolution: "bundler",
        strict: true,
        noEmit: true,
        skipLibCheck: true,
      },
      include: ["catalog.ts", "fixture.ts"],
    };
    writeFileSync(join(tmp, "tsconfig.json"), JSON.stringify(tsconfig, null, 2));

    // Use npx to invoke a cached typescript. `-p typescript@x` ensures the
    // package is fetched and the `tsc` bin from it is on PATH (`npx -y typescript`
    // fails because the package's `bin` key is `tsc`, not `typescript`).
    execFileSync("npx", ["-y", "-p", "typescript@5.6.3", "tsc", "-p", tmp], {
      stdio: "pipe",
      env: { ...process.env, npm_config_yes: "true" },
    });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
