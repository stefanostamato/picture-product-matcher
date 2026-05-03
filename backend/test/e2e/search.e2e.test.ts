import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import request from "supertest";

import { createApp } from "../../src/app.js";
import { closeCatalogClient } from "../../src/catalog/index.js";

// Live end-to-end smoke. Hits the real OpenAI vision API with the user's key
// and the real read-only Mongo Atlas catalog. Skipped unless explicitly opted
// into via `RUN_E2E=1` and the required env vars are present, so CI and
// regular `npm test` runs stay hermetic and fast.

const FIXTURE_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../fixtures/sofa.jpg",
);

const SHOULD_RUN =
  process.env.RUN_E2E === "1" &&
  typeof process.env.OPENAI_API_KEY === "string" &&
  process.env.OPENAI_API_KEY.length > 0 &&
  typeof process.env.DB_URL === "string" &&
  process.env.DB_URL.length > 0;

describe.skipIf(!SHOULD_RUN)("e2e POST /search (live OpenAI + Atlas)", () => {
  afterAll(async () => {
    await closeCatalogClient();
  });

  it("returns ranked products with the expected pipeline stages", async () => {
    const image = await readFile(FIXTURE_PATH);
    const app = createApp();

    const res = await request(app)
      .post("/search")
      .set("x-api-key", process.env.OPENAI_API_KEY as string)
      .field("prompt", "comfortable brown sofa for a living room")
      .attach("image", image, {
        filename: "sofa.jpg",
        contentType: "image/jpeg",
      });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.results)).toBe(true);
    expect(res.body.results.length).toBeGreaterThan(0);
    expect(res.body.meta.stagesRan).toEqual(
      expect.arrayContaining(["visionExtract", "queryBuild", "catalogSearch"]),
    );
    expect(typeof res.body.meta.latencyMs).toBe("number");
    expect(res.body.meta.extracted).toBeDefined();
    expect(typeof res.body.meta.extracted.description).toBe("string");
  }, 60_000);
});
