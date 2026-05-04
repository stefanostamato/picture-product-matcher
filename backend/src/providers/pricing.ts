// USD per-token rates and per-image rates for the model identifiers we ship
// against. Values come from the public OpenAI rate cards as listed at
// https://openai.com/api/pricing/ on 2026-05-03. Rates are quoted per 1M tokens
// in the rate card; we store them per single token so the math reads naturally
// at call sites. Keep this table small and explicit — adding a new model is one
// line, and reviewers should be able to eyeball the value against the rate card
// without arithmetic.

export class UnknownModelError extends Error {
  constructor(model: string) {
    super(`Unknown model for pricing: ${model}`);
    this.name = "UnknownModelError";
  }
}

interface TokenRate {
  /** USD per single prompt (input) token. */
  promptPerToken: number;
  /** USD per single completion (output) token. */
  completionPerToken: number;
}

const TOKEN_RATES: Record<string, TokenRate> = {
  // gpt-4o-mini: $0.15 / 1M input, $0.60 / 1M output
  "gpt-4o-mini": {
    promptPerToken: 0.15 / 1_000_000,
    completionPerToken: 0.6 / 1_000_000,
  },
  // gpt-4o: $2.50 / 1M input, $10.00 / 1M output
  "gpt-4o": {
    promptPerToken: 2.5 / 1_000_000,
    completionPerToken: 10.0 / 1_000_000,
  },
};

const IMAGE_RATES: Record<string, number> = {
  // gpt-image-1: standard 1024x1024 image generation, ~$0.04 per image.
  "gpt-image-1": 0.04,
};

export function priceFor(
  model: string,
  promptTokens: number,
  completionTokens: number,
): number {
  const rate = TOKEN_RATES[model];
  if (!rate) throw new UnknownModelError(model);
  return (
    promptTokens * rate.promptPerToken +
    completionTokens * rate.completionPerToken
  );
}

export function priceForImage(model: string, count: number): number {
  const rate = IMAGE_RATES[model];
  if (rate === undefined) throw new UnknownModelError(model);
  return rate * count;
}
