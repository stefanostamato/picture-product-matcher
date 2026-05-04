import { readFile, writeFile, access, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import OpenAI from "openai";

import { getApiKey } from "./_prompt-key.js";

// Generates the gold-set images by calling `gpt-image-1` once per sampled
// product. Idempotent: skips files that already exist on disk so re-running
// after a partial failure does not double-bill the API. Fails loud on the
// first API error rather than silently writing partial fixtures.
//
// Reads `backend/eval/fixtures/gold/_sample.json` (produced by
// `sample-products.ts`) and writes JPEGs as `{productId}.jpg` next to it.

interface GoldSampleInput {
  productId: string;
  category: string;
  type: string;
  title: string;
  description: string;
}

const MODEL = "gpt-image-1";
const IMAGE_SIZE = "1024x1024";

function buildPrompt(sample: GoldSampleInput): string {
  return `Photo of a room featuring ${sample.description}`;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function generateOne(
  client: OpenAI,
  sample: GoldSampleInput,
  outPath: string,
): Promise<void> {
  const response = await client.images.generate({
    model: MODEL,
    prompt: buildPrompt(sample),
    size: IMAGE_SIZE,
    n: 1,
  });

  const b64 = response.data?.[0]?.b64_json;
  if (typeof b64 !== "string" || b64.length === 0) {
    throw new Error(
      `image-gen: empty b64_json from provider for ${sample.productId}`,
    );
  }

  const bytes = Buffer.from(b64, "base64");
  await writeFile(outPath, bytes);
}

async function main(): Promise<void> {
  const apiKey = await getApiKey();

  const here = dirname(fileURLToPath(import.meta.url));
  const goldDir = resolve(here, "..", "fixtures", "gold");
  const samplePath = resolve(goldDir, "_sample.json");

  const raw = await readFile(samplePath, "utf8").catch(() => {
    throw new Error(
      `Could not read ${samplePath}. Run 'npm run gold:sample' first.`,
    );
  });
  const samples = JSON.parse(raw) as GoldSampleInput[];
  await mkdir(goldDir, { recursive: true });

  const client = new OpenAI({ apiKey });

  let written = 0;
  let skipped = 0;
  for (const sample of samples) {
    const outPath = resolve(goldDir, `${sample.productId}.jpg`);
    if (await fileExists(outPath)) {
      skipped++;
      continue;
    }
    try {
      await generateOne(client, sample, outPath);
    } catch (err) {
      // Fixed user-safe message — never echo upstream content, which can
      // include the API key in some failure paths.
      const detail = err instanceof Error ? err.message : "unknown error";
      throw new Error(
        `image-gen: failed for ${sample.productId} (${detail.replace(apiKey, "[redacted]")}).`,
      );
    }
    written++;
    // eslint-disable-next-line no-console
    console.log(`wrote ${sample.productId}.jpg`);
  }

  // eslint-disable-next-line no-console
  console.log(
    `Done. Wrote ${written} images, skipped ${skipped} already-present.`,
  );
}

const isDirectRun =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("generate-gold.ts");

if (isDirectRun) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
