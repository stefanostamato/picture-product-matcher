import { readFile, writeFile, access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import OpenAI from "openai";

import { getApiKey } from "./_prompt-key.js";

// Builds the per-product attribute sidecars used by the eval scorer.
//
// For each sample produced by `sample-products.ts`, calls `gpt-4o-mini` at
// `temperature: 0` with a structured-JSON response of `{ color, material,
// style }` (each `string[]`). Writes one sidecar JSON per product to
// `backend/eval/fixtures/gold/{productId}.json`.
//
// The CLI is idempotent — sidecars that already exist on disk are skipped so
// re-running after a partial failure does not double-bill the API.

export interface GoldSampleInput {
  productId: string;
  category: string;
  type: string;
  title: string;
  description: string;
}

export interface GoldSidecar extends GoldSampleInput {
  color: string[];
  material: string[];
  style: string[];
}

export interface ExtractGoldAttrsOptions {
  apiKey: string;
  model?: string;
}

const DEFAULT_MODEL = "gpt-4o-mini";

const SYSTEM_PROMPT = [
  "You extract concise tag lists for furniture catalog entries.",
  "Given a product's title and description, list its dominant colors, materials, and styles.",
  "Each list contains lowercase, single-word or short-phrase tags (e.g. 'oak', 'mid-century').",
  "Empty arrays are valid when the relevant attribute is not described in the input.",
  "Reply with a JSON object exactly matching the provided schema.",
].join(" ");

const RESPONSE_SCHEMA = {
  name: "gold_attributes",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      color: { type: "array", items: { type: "string" } },
      material: { type: "array", items: { type: "string" } },
      style: { type: "array", items: { type: "string" } },
    },
    required: ["color", "material", "style"],
  },
  strict: true,
} as const;

interface RawAttrs {
  color?: unknown;
  material?: unknown;
  style?: unknown;
}

function buildUserContent(sample: GoldSampleInput): string {
  return [
    `Category: ${sample.category}`,
    `Type: ${sample.type}`,
    `Title: ${sample.title}`,
    `Description: ${sample.description}`,
  ].join("\n");
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

export async function extractGoldAttrs(
  sample: GoldSampleInput,
  options: ExtractGoldAttrsOptions,
): Promise<GoldSidecar> {
  const client = new OpenAI({ apiKey: options.apiKey });
  const model = options.model ?? DEFAULT_MODEL;

  let completion: { choices: Array<{ message: { content?: string | null } }> };
  try {
    completion = (await client.chat.completions.create({
      model,
      temperature: 0,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserContent(sample) },
      ],
      response_format: { type: "json_schema", json_schema: RESPONSE_SCHEMA },
    })) as typeof completion;
  } catch {
    // Fixed user-safe message — never echo the upstream error, which can
    // contain the API key in some upstream paths.
    throw new Error("attr-extract: provider rejected the request.");
  }

  const content = completion.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.length === 0) {
    throw new Error("attr-extract: empty model response.");
  }

  let parsed: RawAttrs;
  try {
    parsed = JSON.parse(content) as RawAttrs;
  } catch {
    throw new Error("attr-extract: model response was not valid JSON.");
  }

  if (
    !isStringArray(parsed.color) ||
    !isStringArray(parsed.material) ||
    !isStringArray(parsed.style)
  ) {
    throw new Error("attr-extract: model response missing required arrays.");
  }

  return {
    productId: sample.productId,
    category: sample.category,
    type: sample.type,
    title: sample.title,
    description: sample.description,
    color: parsed.color,
    material: parsed.material,
    style: parsed.style,
  };
}

// ---------- CLI entry ----------

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
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

  let written = 0;
  let skipped = 0;
  for (const sample of samples) {
    const outPath = resolve(goldDir, `${sample.productId}.json`);
    if (await fileExists(outPath)) {
      skipped++;
      continue;
    }
    const sidecar = await extractGoldAttrs(sample, { apiKey });
    await writeFile(outPath, JSON.stringify(sidecar, null, 2) + "\n", "utf8");
    written++;
    // eslint-disable-next-line no-console
    console.log(`wrote ${sample.productId}.json`);
  }

  // eslint-disable-next-line no-console
  console.log(
    `Done. Wrote ${written} sidecars, skipped ${skipped} already-present.`,
  );
}

const isDirectRun =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("extract-gold-attrs.ts");

if (isDirectRun) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
