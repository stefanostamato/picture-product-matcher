import OpenAI from "openai";
import { PRODUCT_CATEGORIES } from "shared/catalog";
import type { ExtractedAttributes } from "shared/wire";
import { ProviderError, type ExtractFromImageInput, type Provider } from "./types.js";

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

async function extractFromImage(
  input: ExtractFromImageInput,
): Promise<ExtractedAttributes> {
  const client = new OpenAI({ apiKey: input.apiKey });

  let completion: { choices: Array<{ message: { content?: string | null } }> };
  try {
    completion = (await client.chat.completions.create({
      model: input.model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserContent(input) },
      ],
      response_format: { type: "json_schema", json_schema: RESPONSE_SCHEMA },
    })) as typeof completion;
  } catch {
    // Defensive scrubbing: even though the OpenAI SDK does not embed the API
    // key in its errors, we never echo upstream messages — we surface a
    // fixed, user-safe message so the key cannot leak via logs or error
    // responses.
    throw new ProviderError({
      code: "PROVIDER_HTTP_ERROR",
      message: "The model provider rejected the request.",
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

  return toExtracted(parsed);
}

export const openAIProvider: Provider = {
  name: "openai",
  extractFromImage,
};
