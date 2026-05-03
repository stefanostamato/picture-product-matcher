# CHANGELOG

Each entry maps to a plan in `plans/`, newest first. Plans are right-
sized task graphs the `/plan` command produced from a feature
description; the `/execute` command then fans them out across parallel
subagents. `NOTES.md` has the play-by-play and the originating prompts.

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
