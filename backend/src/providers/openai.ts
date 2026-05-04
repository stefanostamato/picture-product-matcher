import OpenAI from "openai";
import { PRODUCT_CATEGORIES } from "shared/catalog";
import type { ExtractedAttributes } from "shared/wire";
import {
  ProviderError,
  type ExtractFromImageInput,
  type ExtractFromImageResult,
  type Provider,
} from "./types.js";

// The model signals "I cannot match this image" by setting `unrecognized: true`
// in the structured JSON response; the adapter converts that into a typed
// ProviderError so the pipeline can surface a graceful error to the user.
const UNRECOGNIZED_FLAG = "unrecognized";

const CATEGORY_LIST = PRODUCT_CATEGORIES.join(", ");

const SYSTEM_PROMPT = [
  "You analyze a product photo and extract attributes used to query a furniture catalog.",
  "Reply with a JSON object that matches the provided schema exactly.",
  "If the image is unreadable or contains no recognizable furniture/product, set `unrecognized` to true and leave the other fields empty.",
  "Otherwise, fill the fields you can infer and always include a one-sentence `description` suitable for a text search.",
  `The catalog has exactly these categories — pick the closest matching one for the \`category\` field: ${CATEGORY_LIST}.`,
].join(" ");

const RESPONSE_SCHEMA = {
  name: "extracted_attributes",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      unrecognized: { type: "boolean" },
      category: { type: "string", enum: [...PRODUCT_CATEGORIES] },
      type: { type: "string" },
      style: { type: "string" },
      material: { type: "string" },
      color: { type: "string" },
      dimensions: {
        type: "object",
        additionalProperties: false,
        properties: {
          width: { type: "number" },
          height: { type: "number" },
          depth: { type: "number" },
        },
      },
      priceBand: { type: "string", enum: ["low", "mid", "high"] },
      description: { type: "string" },
    },
    required: ["description"],
  },
  strict: false,
} as const;

interface RawExtraction {
  unrecognized?: boolean;
  category?: string;
  type?: string;
  style?: string;
  material?: string;
  color?: string;
  dimensions?: { width?: number; height?: number; depth?: number };
  priceBand?: "low" | "mid" | "high";
  description?: string;
}

function buildUserContent(input: ExtractFromImageInput) {
  const dataUrl = `data:${input.mimeType};base64,${input.image.toString("base64")}`;
  const promptText = input.userPrompt
    ? `User prompt: ${input.userPrompt}\nExtract attributes for catalog search.`
    : "Extract attributes for catalog search.";
  return [
    { type: "text" as const, text: promptText },
    { type: "image_url" as const, image_url: { url: dataUrl } },
  ];
}

function toExtracted(raw: RawExtraction): ExtractedAttributes {
  const out: ExtractedAttributes = {
    description: typeof raw.description === "string" ? raw.description : "",
  };
  if (raw.category) out.category = raw.category;
  if (raw.type) out.type = raw.type;
  if (raw.style) out.style = raw.style;
  if (raw.material) out.material = raw.material;
  if (raw.color) out.color = raw.color;
  if (raw.priceBand) out.priceBand = raw.priceBand;
  if (raw.dimensions && typeof raw.dimensions === "object") {
    out.dimensions = { ...raw.dimensions };
  }
  return out;
}

interface RawCompletion {
  choices: Array<{ message: { content?: string | null } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  } | null;
}

// The Node SDK retries 429 / 5xx / network errors automatically with
// exponential backoff and honors `Retry-After`. Default is 2 retries; we
// bump to 5 so a brief burst against per-minute limits resolves transparently
// instead of bubbling out as a `PROVIDER_HTTP_ERROR`. 5 retries × 8s max
// backoff is bounded — never an unbounded wait.
const SDK_MAX_RETRIES = 5;

async function extractFromImage(
  input: ExtractFromImageInput,
): Promise<ExtractFromImageResult> {
  const client = new OpenAI({
    apiKey: input.apiKey,
    maxRetries: SDK_MAX_RETRIES,
  });

  let completion: RawCompletion;
  try {
    completion = (await client.chat.completions.create({
      model: input.model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserContent(input) },
      ],
      response_format: { type: "json_schema", json_schema: RESPONSE_SCHEMA },
    })) as RawCompletion;
  } catch (err) {
    // Defensive scrubbing: we never echo the upstream `.message` (it can
    // occasionally include request details). The SDK's `.status` (HTTP int)
    // and `.code` (documented enum, e.g. "insufficient_quota",
    // "invalid_api_key", "model_not_found") are safe to surface — they
    // never contain the API key.
    const upstream = err as { status?: number; code?: string };
    const upstreamStatus =
      typeof upstream?.status === "number" ? upstream.status : undefined;
    const upstreamCode =
      typeof upstream?.code === "string" ? upstream.code : undefined;
    throw new ProviderError({
      code: "PROVIDER_HTTP_ERROR",
      message: "The model provider rejected the request.",
      upstreamStatus,
      upstreamCode,
    });
  }

  const content = completion.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.length === 0) {
    throw new ProviderError({
      code: "INVALID_RESPONSE",
      message: "The model returned an empty response.",
    });
  }

  let parsed: RawExtraction;
  try {
    parsed = JSON.parse(content) as RawExtraction;
  } catch {
    throw new ProviderError({
      code: "INVALID_RESPONSE",
      message: "The model response was not valid JSON.",
    });
  }

  if (parsed[UNRECOGNIZED_FLAG] === true) {
    throw new ProviderError({
      code: "UNRECOGNIZED_IMAGE",
      message: "We couldn't recognize the contents of this image.",
    });
  }

  const usage = {
    promptTokens: completion.usage?.prompt_tokens ?? 0,
    completionTokens: completion.usage?.completion_tokens ?? 0,
    model: input.model,
  };

  return { extracted: toExtracted(parsed), usage };
}

export const openAIProvider: Provider = {
  name: "openai",
  extractFromImage,
};
