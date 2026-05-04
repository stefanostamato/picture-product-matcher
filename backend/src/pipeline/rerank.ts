import type { Product } from "shared/catalog";
import type { ExtractedAttributes } from "shared/wire";
import type { Provider } from "../providers/index.js";
import type { ProviderUsage } from "../providers/types.js";

export interface RerankDeps {
  enabled: boolean;
  provider: Provider;
  apiKey: string;
  image: Buffer;
  mimeType: string;
  model: string;
  systemPrompt: string;
  topN: number;
}

export interface RerankResult {
  /** Final ordering. When the stage short-circuits or falls back, this matches the input. */
  products: Product[];
  /** Present only when the provider was actually called (and replied). */
  usage?: ProviderUsage;
}

// Reorder-only LLM rerank over the top-N catalog candidates. The adapter
// returns whatever id list the model produced; this stage validates that the
// returned set is a strict permutation of the head and falls back to the
// catalog order when it is not. Tail products beyond `topN` are passed through
// untouched.
export async function rerank(
  results: Product[],
  _attributes: ExtractedAttributes,
  deps: RerankDeps,
): Promise<RerankResult> {
  if (!deps.enabled) return { products: results };
  if (results.length <= 1) return { products: results };

  const head = results.slice(0, deps.topN);
  const tail = results.slice(deps.topN);

  const { orderedIds, usage } = await deps.provider.rerankWithImage({
    apiKey: deps.apiKey,
    model: deps.model,
    systemPrompt: deps.systemPrompt,
    image: deps.image,
    mimeType: deps.mimeType,
    candidates: head.map((p) => ({
      id: p._id,
      title: p.title,
      description: p.description,
    })),
  });

  const headIds = head.map((p) => p._id);
  if (!isPermutation(orderedIds, headIds)) {
    return { products: results, usage };
  }

  const byId = new Map(head.map((p) => [p._id, p]));
  const reorderedHead = orderedIds.map((id) => byId.get(id)!);
  return { products: [...reorderedHead, ...tail], usage };
}

function isPermutation(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const expected = new Set(b);
  const seen = new Set<string>();
  for (const id of a) {
    if (!expected.has(id)) return false;
    if (seen.has(id)) return false;
    seen.add(id);
  }
  return true;
}
