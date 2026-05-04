import { readFileSync, existsSync } from "node:fs";
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { PRODUCT_CATEGORIES, PRODUCT_TYPES_BY_CATEGORY } from "shared/catalog";

export type ProviderName = "openai";

export type Config = {
  topK: number;
  rerank: boolean;
  provider: ProviderName;
  visionModel: string;
  visionPrompt: string;
  rerankModel: string;
  rerankPrompt: string;
  rerankTopN: number;
};

const CATEGORY_LIST = PRODUCT_CATEGORIES.join(", ");

const TYPES_BY_CATEGORY_LINES = PRODUCT_CATEGORIES.map(
  (c) => `  - ${c}: ${PRODUCT_TYPES_BY_CATEGORY[c].join(", ")}`,
).join("\n");

export const DEFAULT_VISION_PROMPT = [
  "You analyze a product photo and extract attributes used to query a furniture catalog.",
  "Reply with a JSON object that matches the provided schema exactly.",
  "If the image is unreadable or contains no recognizable furniture/product, set `unrecognized` to true and leave the other fields empty.",
  "Otherwise, fill the fields you can infer and always include a one-sentence `description` suitable for a text search.",
  `The catalog has exactly these categories — pick the closest matching one for the \`category\` field: ${CATEGORY_LIST}.`,
  `The \`type\` field must be one of the values listed for the chosen category below; if none fit, leave \`type\` empty rather than inventing one:\n${TYPES_BY_CATEGORY_LINES}`,
].join(" ");

export const DEFAULT_RERANK_PROMPT = [
  "You are a furniture-catalog reranker.",
  "Given a user-uploaded image and a JSON list of candidate products (id, title, description),",
  "return a JSON object { orderedIds: string[] } reordering the candidates from most to least visually relevant to the image.",
  "The output id set must exactly equal the input id set — do not drop, add, or invent ids.",
].join(" ");

const defaults: Config = {
  topK: 20,
  rerank: true,
  provider: "openai",
  visionModel: "gpt-4o-mini",
  visionPrompt: DEFAULT_VISION_PROMPT,
  rerankModel: "gpt-4o-mini",
  rerankPrompt: DEFAULT_RERANK_PROMPT,
  rerankTopN: 20,
};

const DEFAULT_FILE_PATH = path.resolve(process.cwd(), "data/config.json");

let configFilePath: string = DEFAULT_FILE_PATH;
let current: Config = { ...defaults };
let bootstrapped = false;

export const CONFIG_FILE_PATH = DEFAULT_FILE_PATH;

export function setConfigFilePath(filePath: string): void {
  configFilePath = filePath;
  bootstrapped = false;
  current = { ...defaults };
}

type ValidatorFn = (value: unknown) => string | null;

const VALIDATORS: Record<keyof Config, ValidatorFn> = {
  topK: (v) =>
    typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 100
      ? null
      : "topK must be an integer in [1, 100]",
  rerank: (v) => (typeof v === "boolean" ? null : "rerank must be a boolean"),
  provider: (v) => (v === "openai" ? null : "provider must be 'openai'"),
  visionModel: (v) =>
    typeof v === "string" && v.length > 0 && v.length <= 200
      ? null
      : "visionModel must be a non-empty string up to 200 chars",
  visionPrompt: (v) =>
    typeof v === "string" && v.length > 0 && v.length <= 2000
      ? null
      : "visionPrompt must be a non-empty string up to 2000 chars",
  rerankModel: (v) =>
    typeof v === "string" && v.length > 0 && v.length <= 200
      ? null
      : "rerankModel must be a non-empty string up to 200 chars",
  rerankPrompt: (v) =>
    typeof v === "string" && v.length > 0 && v.length <= 2000
      ? null
      : "rerankPrompt must be a non-empty string up to 2000 chars",
  rerankTopN: (v) =>
    typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 50
      ? null
      : "rerankTopN must be an integer in [1, 50]",
};

export type ValidateResult =
  | { ok: true; value: Partial<Config> }
  | { ok: false; errors: string[] };

export function validateConfig(partial: unknown): ValidateResult {
  if (partial === null || typeof partial !== "object" || Array.isArray(partial)) {
    return { ok: false, errors: ["config must be an object"] };
  }
  const errors: string[] = [];
  const value: Partial<Config> = {};
  const input = partial as Record<string, unknown>;
  for (const key of Object.keys(input)) {
    if (!(key in VALIDATORS)) {
      errors.push(`unknown key: ${key}`);
      continue;
    }
    const typedKey = key as keyof Config;
    const raw = input[key];
    if (raw === undefined) continue;
    const err = VALIDATORS[typedKey](raw);
    if (err) {
      errors.push(err);
    } else {
      (value[typedKey] as Config[keyof Config]) = raw as Config[keyof Config];
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value };
}

function loadFromDisk(): void {
  bootstrapped = true;
  if (!existsSync(configFilePath)) {
    current = { ...defaults };
    return;
  }
  let raw: string;
  try {
    raw = readFileSync(configFilePath, "utf8");
  } catch (err) {
    console.warn(
      `[config] could not read ${configFilePath}; using defaults`,
      (err as Error).message,
    );
    current = { ...defaults };
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.warn(
      `[config] ${configFilePath} is not valid JSON; using defaults`,
      (err as Error).message,
    );
    current = { ...defaults };
    return;
  }
  const result = validateConfig(parsed);
  if (!result.ok) {
    console.warn(
      `[config] ${configFilePath} failed validation; using defaults: ${result.errors.join("; ")}`,
    );
    current = { ...defaults };
    return;
  }
  current = { ...defaults, ...result.value };
}

export function reloadConfigFromDisk(): void {
  bootstrapped = false;
  ensureBootstrapped();
}

function ensureBootstrapped(): void {
  if (bootstrapped) return;
  loadFromDisk();
}

export function getConfig(): Config {
  ensureBootstrapped();
  return { ...current };
}

async function persist(config: Config): Promise<void> {
  const dir = path.dirname(configFilePath);
  await mkdir(dir, { recursive: true });
  const tmpPath = `${configFilePath}.tmp`;
  await writeFile(tmpPath, JSON.stringify(config, null, 2), "utf8");
  await rename(tmpPath, configFilePath);
}

export async function setConfig(partial: Partial<Config>): Promise<Config> {
  ensureBootstrapped();
  const filtered: Record<string, unknown> = {};
  for (const key of Object.keys(partial)) {
    const typedKey = key as keyof Config;
    const value = partial[typedKey];
    if (value === undefined) continue;
    filtered[key] = value;
  }
  if (Object.keys(filtered).length === 0) {
    return { ...current };
  }
  const result = validateConfig(filtered);
  if (!result.ok) {
    throw new Error(`invalid config: ${result.errors.join("; ")}`);
  }
  const next: Config = { ...current, ...result.value };
  await persist(next);
  current = next;
  return { ...current };
}

export async function resetConfig(): Promise<void> {
  current = { ...defaults };
  bootstrapped = true;
  try {
    await unlink(configFilePath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      throw err;
    }
  }
}
