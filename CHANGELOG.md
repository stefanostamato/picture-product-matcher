# CHANGELOG

Each entry maps to a plan in `plans/`, newest first. Plans are right-
sized task graphs the `/plan` command produced from a feature
description; the `/execute` command then fans them out across parallel
subagents. `NOTES.md` has the play-by-play and the originating prompts.

## v2 — eval-harness

Plan: [`plans/eval-harness.md`](plans/eval-harness.md).

### What shipped

- Per-request diagnostic panel under search results, gated on
  `import.meta.env.DEV`. Shows extracted attributes, the built query,
  the top-3 raw catalog hits with scores, stage execution order +
  total latency, prompt/completion/total tokens, and the call's USD
  cost to 5-decimal precision. Stripped from production builds.
- Token + cost accounting end-to-end. Provider adapters now return
  `usage: { promptTokens, completionTokens, model }` alongside the
  extracted attributes; a hard-coded pricing table at the provider
  layer (USD/token, USD/image) feeds a `costUsd` aggregate the
  pipeline attaches to `SearchResponse.meta`. Top-3 raw catalog
  scores ride along on the same payload.
- Local-only eval harness at `backend/eval/`. Runnable via
  `npm run eval`; iterates a frozen 30-item gold set (2 products per
  category × 15 categories), drives `runPipeline`, scores
  recall@1/5/20, MRR, category/type/attribute hits, latency, tokens,
  and cost, prints overall + per-category to stdout, and appends one
  row to `history.jsonl` pinned by git SHA + goldSetVersion + config
  snapshot.
- The frozen gold set, committed. 30 generated room photos
  (`gpt-image-1`) with attribute sidecars (`gpt-4o-mini`,
  `temperature: 0`). Plus 10 manually curated Unsplash photos under
  permissive licenses for human eyeballing — not scored.
- Three one-shot fixture scripts: `gold:sample`, `gold:generate`,
  `gold:attrs`, plus `manual:fetch`. Idempotent; skip already-written
  files so partial failures (rate limit, credits) re-run cleanly.
- Upstream provider error detail surfaced through to the banner —
  `PROVIDER_ERROR` responses now carry `upstreamStatus` (HTTP) and
  `upstreamCode` so users can distinguish "your key" from "their
  service" without us forking error copy.
- Admin-ui plan checked in at [`plans/admin-ui.md`](plans/admin-ui.md)
  as the next slice; not built here.

### Architecture decisions

- **Pricing at the provider layer, not in eval.** Cost depends on
  per-model rates and the diag panel needs the same number a future
  Anthropic adapter would need to compute. Living at the provider
  boundary means each adapter ships its own rate card without the
  orchestrator caring.
- **Diag panel and eval are different surfaces.** The diag panel
  inspects whatever the user just searched; the eval harness scores
  against a frozen gold set. Same plumbing (`meta.tokens`,
  `meta.costUsd`, `meta.topResults`) feeds both, but I'd rather have
  one path that's clear about which job it's doing than overload
  either side.
- **Closed-vocab category, mirrored on the gold set.** `gpt-image-1`
  generates the room photo from the catalog description; the gold
  sidecar is extracted from the same description by `gpt-4o-mini`
  rather than by re-running the live vision stage, so the eval
  isn't grading the vision model on its own output. Some
  circularity remains — both calls are GPT-family — which is why
  the manual subset of real-world photos exists as a sanity check.
- **Stratified gold-set sampling.** Two products per category, two
  different `type` values where possible. Covers more search-space
  per dollar than uniform-random sampling at the gold-set sizes I
  can afford.
- **Append-only history pinned by git SHA + goldSetVersion +
  config.** Config is mutable at runtime (admin UI is next), so the
  snapshot is what makes rows comparable. `goldSetVersion` ("v1"
  today) lets me extend the fixtures later without invalidating the
  history. The admin UI will read this file to render quality over
  time.
- **Eval consumes `runPipeline` directly, not a copy.** The runner
  imports the same orchestrator the API layer calls, so what the
  eval scores is exactly what production runs. Future pipeline
  changes don't need an eval-side counterpart.
- **OpenAI key prompted on stdin, never in env or `.env`.** Each
  fixture script and the eval CLI prompt for the key with input
  hidden; the value lives in process memory only. Mongo URL stays
  in `.env` (it's read-only and unprivileged); the OpenAI key is
  the one secret worth a per-run prompt.
- **No precision/F1/NDCG.** One true positive per query at this
  scale, so recall@K + MRR is the honest set of metrics; the rest
  would add noise and false signal.
- **Pricing rate table is hand-edited and dated.** Header comment
  in `pricing.ts` records the rate-card date. Reviewers can eyeball
  the values without arithmetic; future drift is one line.

### Out of scope (deferred by design)

Admin UI to render `history.jsonl` (planned next),
LLM-as-judge relevance scoring, A/B harness comparing two configs in
one run (run twice, diff the JSONL rows manually), CI integration
(eval is local-only, hits paid APIs), and any provider beyond
OpenAI. The actual LLM rerank stage is still a stub — landing it
is now the highest-expected-lift item on the roadmap.

### Driving prompts

The originating ask, paraphrased from the brief:

> Read NOTES.md and propose a lightweight eval harness we could add
> here. Inspect the problem space, think critically, suggest metrics
> that would be relevant to capture, and a lightweight harness that
> can accomplish these things. Simplicity is key, but built with
> scale in mind — not just more data, but as the project grows and
> if we make adjustments to the search pipeline.

Also: a follow-up nudge to keep the diagnostic panel and the eval
harness as separate surfaces rather than collapsing them — they
serve different jobs and the seam is small.

### Mid-flight fixes

- `costUsd` calc owned by the orchestrator (`run.ts`), not by
  individual stages. Stages return `usage`; the orchestrator
  sums and prices once. Keeps each stage cheap to test in isolation
  and avoids double-counting when rerank lands.
- Gold-set OpenAI calls switched from env to stdin-prompt mid-build.
  Avoids the failure mode where someone puts the key in `.env` for
  convenience and then commits it.
- One pre-existing fixture in [backend/src/api/search.test.ts](backend/src/api/search.test.ts)
  and one in [frontend/src/lib/api/searchClient.test.ts](frontend/src/lib/api/searchClient.test.ts)
  needed additive `tokens`/`costUsd`/`topResults` entries to keep
  `tsc --noEmit` clean once the wire types extended. Trivial; no
  behaviour change.
- Negative `p50LatencyMs` value in one history row (`Cabinets`
  category) — looks like a stale or out-of-order metric snapshot;
  flagged but not chased here.

## v1 — initial-e2e

Plan: [`plans/initial-e2e.md`](plans/initial-e2e.md).

### What shipped

- Pipeline-shaped backend: `visionExtract → queryBuild →
  catalogSearch → rerank` (stub, off by default), wired by a
  `runPipeline` orchestrator with injected dependencies.
- OpenAI vision adapter behind a `Provider` interface. Adding a
  second provider is one new file in `backend/src/providers/`.
- `searchCatalog` module — the only place in the backend that
  imports `mongodb`. Runs `$text` scoring with an optional canonical
  category filter.
- `POST /search` (Express + multer): accepts the multipart image +
  optional prompt, requires `x-api-key`, returns a typed
  `SearchResponse` with per-stage latency and a `lowConfidence` flag
  for empty-result cases.
- Single React + Vite page: API-key input, image drop, prompt,
  results grid, error and low-confidence banners. Key lives in React
  context — never `localStorage`, never `sessionStorage`.
- Env-guarded e2e smoke under `backend/test/e2e/` that hits real
  OpenAI + Atlas when `RUN_E2E=1` and skips cleanly otherwise.

### Architecture decisions

- **Pipeline-shaped, not framework-shaped.** I want the unit of
  iteration to be a stage, not a route or a class. Reordering, A/B-
  ing, or swapping a stage shouldn't ripple into HTTP or DB code.
  This is the seam every future ranking strategy plugs into.
- **Provider abstraction at the edge.** The pipeline never imports
  OpenAI directly. The interface is small enough that "vision via a
  different model" or "rerank with a cheaper one" lands without
  surgery — exactly the swappability the brief calls out.
- **Mongo behind one module.** Whoever needs catalog data calls
  `searchCatalog`. No leaking `MongoClient` across the codebase, so
  future caching/index strategies have one home.
- **Config + metrics as first-class plumbing, even before there's an
  admin UI.** The config store (`topK`, `rerank` flag, model names)
  and per-request metrics collector are the seams the eval harness
  and admin surface will plug into. Plumbing them now means later
  features don't need a retrofit.
- **API key never crosses a boundary it doesn't have to.** It
  arrives in `x-api-key`, flows through `runPipeline` as a per-call
  argument, and is scrubbed from any error message that bubbles back
  to the frontend. The mapper in `backend/src/api/errors.ts` is the
  single defence-in-depth point.
- **Category as a closed enum, not a free-form string.** I
  constrained the model's `category` output to the catalog's 15
  canonical values via the structured-output JSON schema, with a
  case-insensitive snap + drop-on-miss fallback in `queryBuild`. A
  loose `"sofa"` vs canonical `"Sofas"` mismatch was silently zeroing
  every result before this; closed-vocab + belt-and-suspenders is
  cheaper than chasing fuzzy matches at query time.
- **Wire format in `shared/`.** Frontend and backend import the same
  types. The `lowConfidence` flag is in the wire format from day one
  because the no-good-matches UX needs to render differently from a
  hard error.

### Out of scope (deferred by design)

LLM rerank stage (interface present, off by default), admin UI, eval
harness, second provider adapter, attribute weighting, price-band
heuristics, production-grade error UX.
