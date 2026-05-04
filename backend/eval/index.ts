import { execFileSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { runPipeline } from "../src/pipeline/run.js";
import { searchCatalog } from "../src/catalog/index.js";
import { getProvider } from "../src/providers/index.js";
import { getConfig } from "../src/config/store.js";
import { createMetrics } from "../src/metrics/collector.js";
import { runEval, type LoadedGoldItem, type RunPipelineFn } from "./runner.js";
import { appendHistory, printReport } from "./reporter.js";
import { getApiKey } from "./scripts/_prompt-key.js";
import { ProviderError } from "../src/providers/index.js";
import type { GoldItem } from "./types.js";

// Bump when the gold-set fixtures are regenerated incompatibly. History rows
// embed this string so we can diff metrics across versions.
const GOLD_SET_VERSION = "v1";

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLD_DIR = resolve(HERE, "fixtures", "gold");

async function loadGold(): Promise<LoadedGoldItem[]> {
  let entries: string[];
  try {
    entries = await readdir(GOLD_DIR);
  } catch {
    return [];
  }

  const sidecarFiles = entries.filter(
    (f) => f.endsWith(".json") && !f.startsWith("_"),
  );

  const out: LoadedGoldItem[] = [];
  for (const file of sidecarFiles.sort()) {
    const sidecarPath = resolve(GOLD_DIR, file);
    const item = parseGoldItem(await readFile(sidecarPath, "utf8"), sidecarPath);
    const imagePath = resolve(GOLD_DIR, `${item.productId}.jpg`);
    const image = await readFile(imagePath);
    out.push({ item, image, mimeType: "image/jpeg" });
  }
  return out;
}

function parseGoldItem(raw: string, path: string): GoldItem {
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  const requiredString = (key: string): string => {
    const v = parsed[key];
    if (typeof v !== "string" || v.length === 0) {
      throw new Error(`Gold sidecar ${path} missing string field: ${key}`);
    }
    return v;
  };
  const requiredArray = (key: string): string[] => {
    const v = parsed[key];
    if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) {
      throw new Error(`Gold sidecar ${path} missing string[] field: ${key}`);
    }
    return v as string[];
  };
  return {
    productId: requiredString("productId"),
    category: requiredString("category"),
    type: requiredString("type"),
    title: requiredString("title"),
    description: requiredString("description"),
    color: requiredArray("color"),
    material: requiredArray("material"),
    style: requiredArray("style"),
  };
}

function readGitSha(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function readGitDirty(): boolean {
  try {
    const out = execFileSync("git", ["status", "--porcelain"], {
      encoding: "utf8",
    });
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const dbUrl = process.env.DB_URL;
  if (!dbUrl) {
    process.stderr.write(
      "eval: skipping — DB_URL is not set; cannot reach the catalog.\n",
    );
    process.exit(0);
  }

  const apiKey = await getApiKey();

  const wrapped: RunPipelineFn = (input) =>
    runPipeline(
      { ...input, apiKey },
      {
        provider: getProvider(getConfig().provider),
        searchCatalog,
        getConfig,
        createMetrics,
      },
    );

  const report = await runEval({
    runPipeline: wrapped,
    loadGold,
    getConfig,
    apiKey,
  });

  printReport(report);

  await appendHistory(report, getConfig() as unknown as Record<string, unknown>, readGitSha(), {
    dirty: readGitDirty(),
    goldSetVersion: GOLD_SET_VERSION,
  });
}

const isDirectRun =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("eval/index.ts");

if (isDirectRun) {
  main().catch((err) => {
    // Never include the API key in the error path. The orchestrator does not
    // log raw env values; downstream pipeline code is already responsible for
    // scrubbing keys from its own errors. ProviderError carries safe
    // upstream metadata (HTTP status + documented error code) — surface
    // these so failures are diagnosable.
    const base = err instanceof Error ? err.message : String(err);
    let suffix = "";
    if (err instanceof ProviderError) {
      const parts: string[] = [`code=${err.code}`];
      if (err.upstreamStatus !== undefined) parts.push(`upstreamStatus=${err.upstreamStatus}`);
      if (err.upstreamCode) parts.push(`upstreamCode=${err.upstreamCode}`);
      suffix = ` (${parts.join(" ")})`;
    }
    process.stderr.write(`eval: ${base}${suffix}\n`);
    process.exit(1);
  });
}
