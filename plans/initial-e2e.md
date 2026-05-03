## Plan: Initial end-to-end vertical slice

## Spec
Ship the thinnest working slice of the picture-product-matcher: a public user uploads an image (with optional text prompt), the backend extracts attributes via an OpenAI vision call, runs a Mongo text search filtered by extracted category, and returns a ranked top-20 list which the frontend renders as a grid. The user supplies their own OpenAI API key in the UI; it is held in memory only and forwarded per request via `x-api-key`. Success = a real photo in, real catalog matches out, with per-stage latency captured for future eval.

## Out of scope
- LLM rerank stage (interface present, off by default)
- Admin UI and admin-only routes
- Eval harness (only the metrics collector it will later consume)
- Auth, sessions, persistence of any kind
- Provider adapters beyond OpenAI (interface must accept a 2nd, but we don't ship one)
- Type-level filter, attribute weighting, price-band heuristics
- Production-grade error UX (we surface errors; we don't design a recovery flow)

## Architecture touchpoints
Per AGENTS.md §3 (repo layout) and §5 (architecture). Repo is greenfield — every directory below is **(new)**.

- `backend/` (new) — Node + TS package. Sub-layers per AGENTS.md §5:
  - `backend/src/api/` — `POST /search` handler, error boundary
  - `backend/src/pipeline/` — `visionExtract`, `queryBuild`, `catalogSearch`, `rerank` (stub), `runPipeline`
  - `backend/src/providers/` — `Provider` interface + `openai.ts` adapter
  - `backend/src/catalog/` — Mongo client + typed `searchCatalog` query
  - `backend/src/config/` — in-memory config store (top-K, rerank flag, model names)
  - `backend/src/metrics/` — per-stage latency collector (no eval, just plumbing)
- `frontend/` (new) — React + TS + Vite package. Per AGENTS.md §5:
  - `frontend/src/pages/PublicSearch.tsx` — single page
  - `frontend/src/components/` — `ImageDrop`, `PromptInput`, `ApiKeyInput`, `ResultsGrid`
  - `frontend/src/lib/api/searchClient.ts` — typed client, attaches `x-api-key`
  - `frontend/src/lib/state/apiKey.ts` — in-memory key store (React context)
- `shared/` (new) — wire-format types only (`SearchRequest`, `SearchResponse`, `Product`, `ExtractedAttributes`)
- `scripts/explore-db.mjs` (new) — one-off discovery script
- `docker-compose.yml` (new) — shape per AGENTS.md §4
- `.env.example`, `.env`, `.gitignore` updates at repo root

## Tasks

### Task T0 — DB discovery & schema doc
- **Goal**: Run a one-off script against the real Mongo catalog and emit a typed schema reference the pipeline tasks build against.
- **Entrypoints**:
  - `scripts/explore-db.mjs` (new)
  - `shared/src/catalog.ts` (new) — exported `Product` type
  - `docs/catalog-schema.md` (new) — sample doc, indexes confirmed, field cardinalities
  - `.env.example` (new), `README.md` (update — add "Database setup" section)
- **Inputs**: Mongo URI from `.env` (already created by user; do not modify or read its contents into any committed artifact). Read the env keys it uses (`MONGO_URI`, plus whatever DB / collection key the user set) and mirror them in `.env.example` with placeholder values.
- **Outputs**: Verified `Product` TypeScript type, schema doc, env template, README setup section.
- **TDD instructions**:
  1. Write `scripts/explore-db.test.mjs` (or a tiny vitest in `shared/`) covering: `Product` type compiles against a fixture document; `.env.example` contains the same keys as the user's existing `.env` with placeholder values.
  2. Confirm tests fail.
  3. Implement: script reads from `.env`, connects, samples 5 docs, lists indexes, prints field+type table; `Product` type & schema doc derived from the output.
  4. Re-read diff. Confirm `.env` is **not** modified or staged (already in `.gitignore`); confirm no real connection string ends up in `.env.example`, `docs/catalog-schema.md`, or any committed file.
- **Subagent prompt**:
  > You are implementing Task T0 of plan `initial-e2e`. Read `AGENTS.md` and `plans/initial-e2e.md` first. Your goal: produce a verified `Product` TypeScript type in `shared/src/catalog.ts`, a `docs/catalog-schema.md` reference, a `scripts/explore-db.mjs` discovery script, a `.env.example` template, and a brief `## Database setup` section in `README.md`. The user has already created `.env` (gitignored) with the real Mongo URI — do not modify it, do not commit it, and do not echo its contents into any committed artifact. Mirror its keys into `.env.example` with placeholder values like `mongodb+srv://USER:PASSWORD@CLUSTER/`. Touch only the entrypoints listed. Follow the TDD instructions. Report: files changed, tests added, tests passing, anything outside scope (don't fix it, just flag it).

### Task T1 — Repo scaffolding & docker-compose
- **Goal**: Scaffold `backend/`, `frontend/`, `shared/` packages with TS, Vitest, and `docker-compose.yml` per AGENTS.md §4.
- **Entrypoints**:
  - `backend/package.json` (deps include `express`, `@types/express`), `backend/tsconfig.json`, `backend/vitest.config.ts`, `backend/Dockerfile`, `backend/src/index.ts`
  - `frontend/package.json`, `frontend/tsconfig.json`, `frontend/vite.config.ts`, `frontend/vitest.config.ts`, `frontend/Dockerfile`, `frontend/index.html`, `frontend/src/main.tsx`, `frontend/src/App.tsx`
  - `shared/package.json`, `shared/tsconfig.json`, `shared/src/index.ts`
  - `docker-compose.yml`, root `package.json` (workspaces optional)
- **Inputs**: AGENTS.md §3, §4.
- **Outputs**: `docker compose up` boots; backend exposes `GET /health` returning `{ ok: true }`; frontend renders an empty page at `localhost:5173`.
- **TDD instructions**:
  1. Write `backend/src/api/health.test.ts` asserting `GET /health` returns 200 + `{ ok: true }`.
  2. Write `frontend/src/App.test.tsx` (vitest + jsdom or `@testing-library/react`) asserting the app renders without throwing.
  3. Confirm both fail.
  4. Implement minimum to pass. No business logic.
- **Subagent prompt**:
  > You are implementing Task T1 of plan `initial-e2e`. Read `AGENTS.md` and `plans/initial-e2e.md` first. Your goal: scaffold `backend/`, `frontend/`, `shared/` packages and a working `docker-compose.yml` per AGENTS.md §4. Backend uses **Express** with a `GET /health` endpoint. Frontend is Vite + React + TS rendering a placeholder page. `shared/` is a TS package re-exported from `shared/src/index.ts`. Vitest configured on both. Follow the TDD instructions. Do not implement search, providers, or UI features — that's other tasks. Do not modify `shared/src/catalog.ts` (T0 owns it). Do not create or modify `.gitignore` or `.env*` files (already handled). Report: files changed, tests added, tests passing, anything outside scope (don't fix it, just flag it).

### Task T2 — Shared wire-format types
- **Goal**: Define the wire-format types both sides consume.
- **Entrypoints**:
  - `shared/src/wire.ts` (new)
  - `shared/src/index.ts` (modify — re-export)
- **Inputs**: `Product` type from T0 (`shared/src/catalog.ts`).
- **Outputs**: Exported types: `ExtractedAttributes`, `SearchRequest` (multipart fields documented in JSDoc), `SearchResponse { results: Product[]; meta: { latencyMs: number; stagesRan: string[]; extracted: ExtractedAttributes } }`, `ApiError { code: string; message: string }`.
- **TDD instructions**:
  1. Write `shared/src/wire.test.ts` covering: `SearchResponse` accepts a fixture with all fields; `ApiError` rejects missing `code` (compile-time `// @ts-expect-error`).
  2. Confirm fail.
  3. Implement.
- **Subagent prompt**:
  > You are implementing Task T2 of plan `initial-e2e`. Read `AGENTS.md` and `plans/initial-e2e.md` first. Your goal: add `shared/src/wire.ts` with the types listed in the task and re-export from `shared/src/index.ts`. Depends on `shared/src/catalog.ts` (already created by T0). Follow the TDD instructions. Touch only `shared/src/wire.ts`, `shared/src/wire.test.ts`, and `shared/src/index.ts`. Report: files changed, tests added, tests passing, anything outside scope (don't fix it, just flag it).

### Task T3 — Provider interface + OpenAI adapter
- **Goal**: Define the swappable `Provider` interface and ship one OpenAI implementation that does vision-extraction.
- **Entrypoints**:
  - `backend/src/providers/types.ts` (new)
  - `backend/src/providers/openai.ts` (new)
  - `backend/src/providers/index.ts` (new) — `getProvider(name)` factory
- **Inputs**: `ExtractedAttributes` from `shared/`.
- **Outputs**: `Provider` interface with `extractFromImage(image: Buffer, mimeType: string, userPrompt?: string, apiKey: string): Promise<ExtractedAttributes>`. OpenAI adapter implements it via `gpt-4o-mini` or `gpt-4o` with a structured JSON-schema response. Factory returns adapter by name; throws clearly if unknown.
- **TDD instructions**:
  1. Write `backend/src/providers/openai.test.ts` covering: (a) returns parsed `ExtractedAttributes` when API mocked with a valid response; (b) throws a typed `ProviderError` on non-2xx; (c) throws `ProviderError` with `code: 'UNRECOGNIZED_IMAGE'` when the model returns an "I can't see anything matchable" sentinel; (d) factory returns the OpenAI adapter when asked, throws on unknown name.
  2. Confirm fail.
  3. Implement using `openai` SDK. Mock the SDK with `vi.mock`.
  4. Re-read diff: confirm the API key is never logged or stringified into errors.
- **Subagent prompt**:
  > You are implementing Task T3 of plan `initial-e2e`. Read `AGENTS.md` and `plans/initial-e2e.md` first. Your goal: define the `Provider` interface in `backend/src/providers/types.ts`, ship `backend/src/providers/openai.ts` using the official `openai` SDK with a structured JSON response for `ExtractedAttributes`, and export a `getProvider(name)` factory from `backend/src/providers/index.ts`. The interface must be designed so adding a second adapter is a single new file. The API key arrives per-call — never read from env, never logged. Follow the TDD instructions. Do not touch pipeline, catalog, or API code. Report: files changed, tests added, tests passing, anything outside scope (don't fix it, just flag it).

### Task T4 — Catalog module (Mongo search)
- **Goal**: One module owns Mongo. Exposes `searchCatalog(query: string, filters: { category?: string }, limit: number): Promise<Product[]>`.
- **Entrypoints**:
  - `backend/src/catalog/client.ts` (new) — connection singleton
  - `backend/src/catalog/search.ts` (new) — `searchCatalog`
  - `backend/src/catalog/index.ts` (new) — barrel
- **Inputs**: `MONGO_URI`, `MONGO_DB`, `MONGO_COLLECTION` from env. `Product` type from T0.
- **Outputs**: `searchCatalog` returns top-N products ranked by Mongo's `$text` score, hard-filtered by `category` if provided.
- **TDD instructions**:
  1. Write `backend/src/catalog/search.test.ts` using `mongodb-memory-server` (or `mongodb-mock`): seed 10 fixture products across 3 categories, ensure text index, then assert: (a) text query returns expected products ordered by score; (b) `category` filter narrows result set; (c) `limit` honored; (d) empty result returns `[]`, not throws.
  2. Confirm fail.
  3. Implement.
  4. Re-read diff: confirm no other module imports `mongodb` directly.
- **Subagent prompt**:
  > You are implementing Task T4 of plan `initial-e2e`. Read `AGENTS.md` and `plans/initial-e2e.md` first. Your goal: implement `backend/src/catalog/{client,search,index}.ts`. Connection lives in a singleton. Only this module talks to Mongo. Use `mongodb-memory-server` for tests so they don't need network. Follow the TDD instructions. Do not import `mongodb` from anywhere else. Report: files changed, tests added, tests passing, anything outside scope (don't fix it, just flag it).

### Task T5 — Config & metrics modules
- **Goal**: Single source of truth for tunable knobs (top-K, rerank on/off, provider name, model name) and a per-request stage-latency collector.
- **Entrypoints**:
  - `backend/src/config/store.ts` (new) — in-memory config with defaults: `topK: 20`, `rerank: false`, `provider: 'openai'`, `visionModel: 'gpt-4o-mini'`
  - `backend/src/metrics/collector.ts` (new) — `createMetrics() => { stage(name): () => void; finalize(): { latencyMs, stagesRan }`
- **Inputs**: None.
- **Outputs**: `getConfig()`, `setConfig(partial)`. `createMetrics()` returns a per-request collector.
- **TDD instructions**:
  1. Write `backend/src/config/store.test.ts` covering: defaults, override, partial update preserves untouched keys.
  2. Write `backend/src/metrics/collector.test.ts` covering: stage timer accumulates correctly; `finalize()` lists stages in order; calling `stage()` twice with same name is allowed.
  3. Confirm fail.
  4. Implement.
- **Subagent prompt**:
  > You are implementing Task T5 of plan `initial-e2e`. Read `AGENTS.md` and `plans/initial-e2e.md` first. Your goal: ship `backend/src/config/store.ts` and `backend/src/metrics/collector.ts`. Both are pure in-memory modules — no I/O. Defaults per the task. Follow the TDD instructions. Do not modify pipeline or API code. Report: files changed, tests added, tests passing, anything outside scope (don't fix it, just flag it).

### Task T6 — Pipeline stages + orchestrator
- **Goal**: Wire T3–T5 into the pipeline shape from AGENTS.md §5, with a stub rerank stage that's off by default.
- **Entrypoints**:
  - `backend/src/pipeline/visionExtract.ts` (new)
  - `backend/src/pipeline/queryBuild.ts` (new)
  - `backend/src/pipeline/catalogSearch.ts` (new)
  - `backend/src/pipeline/rerank.ts` (new — stub passthrough)
  - `backend/src/pipeline/run.ts` (new) — `runPipeline(input, deps): Promise<SearchResponse>`
- **Inputs**: From T2 (`SearchResponse`, `ExtractedAttributes`), T3 (provider), T4 (`searchCatalog`), T5 (config + metrics).
- **Outputs**: `runPipeline` orchestrator that calls stages in order, records per-stage latency, and returns `SearchResponse`.
- **TDD instructions**:
  1. Write a unit test per stage with a fixture input/output; mock the provider and `searchCatalog`.
  2. Write `backend/src/pipeline/run.test.ts`: with mocked deps, verify (a) success path returns ranked products + correct `meta.stagesRan`; (b) provider failure surfaces as a typed error with `code`; (c) zero search results returns an empty array + low-confidence flag in meta (`meta.lowConfidence: true`); (d) rerank stage is skipped when config flag is false.
  3. Confirm fail.
  4. Implement. `queryBuild` should combine extracted `description` with the user prompt (concat, dedupe whitespace). Hard-filter on `category` only when `extracted.category` is present and non-empty.
- **Subagent prompt**:
  > You are implementing Task T6 of plan `initial-e2e`. Read `AGENTS.md` and `plans/initial-e2e.md` first. Your goal: ship the pipeline stages and orchestrator under `backend/src/pipeline/`. Each stage is a small typed function; the orchestrator wires them and uses the metrics collector. Rerank is a stub passthrough off by default. Follow the TDD instructions. Inject all deps (`provider`, `searchCatalog`, `getConfig`, `createMetrics`) — no module-level singletons inside stage code. Touch only files under `backend/src/pipeline/`. Report: files changed, tests added, tests passing, anything outside scope (don't fix it, just flag it).

### Task T7 — API handler + error boundary
- **Goal**: Expose `POST /search` with `multipart/form-data`, `x-api-key` header, and a structured error response.
- **Entrypoints**:
  - `backend/src/api/search.ts` (new)
  - `backend/src/api/errors.ts` (new) — error → `ApiError` mapper
  - `backend/src/index.ts` (modify) — wire route
- **Inputs**: From T6 (`runPipeline`), T2 (`ApiError`).
- **Outputs**: Express route `POST /search` accepting multipart fields `image` (file, ≤8MB, JPEG/PNG/WebP) and `prompt` (string, optional); `x-api-key` header required. Returns `SearchResponse` on success, `ApiError` JSON with appropriate HTTP status on failure.
- **TDD instructions**:
  1. Write `backend/src/api/search.test.ts` (supertest) covering: (a) 200 happy path with mocked `runPipeline`; (b) 400 missing `x-api-key`; (c) 400 missing image; (d) 413 image too large; (e) 415 wrong mime; (f) 502 when pipeline throws `ProviderError`; (g) API key never appears in any response body.
  2. Confirm fail.
  3. Implement using **`multer`** for multipart parsing on the Express route.
- **Subagent prompt**:
  > You are implementing Task T7 of plan `initial-e2e`. Read `AGENTS.md` and `plans/initial-e2e.md` first. Your goal: implement `POST /search` as an Express handler in `backend/src/api/search.ts`, an error mapper in `backend/src/api/errors.ts`, and wire the route into the Express app in `backend/src/index.ts`. Use **`multer`** for multipart parsing, `x-api-key` header for the per-request key, and structured `ApiError` JSON responses. Follow the TDD instructions. Do not modify pipeline or providers. Report: files changed, tests added, tests passing, anything outside scope (don't fix it, just flag it).

### Task T8 — Frontend search page
- **Goal**: Single-page React UI: API key input, image drop, optional prompt, submit, results grid, error state.
- **Entrypoints**:
  - `frontend/src/pages/PublicSearch.tsx` (new)
  - `frontend/src/components/{ImageDrop,PromptInput,ApiKeyInput,ResultsGrid,ErrorBanner}.tsx` (new)
  - `frontend/src/lib/api/searchClient.ts` (new)
  - `frontend/src/lib/state/apiKey.ts` (new) — React context
  - `frontend/src/App.tsx` (modify) — render `PublicSearch`
- **Inputs**: `SearchRequest`, `SearchResponse`, `ApiError` from `shared/`.
- **Outputs**: Working UI at `/`. API key kept in context (memory only, never localStorage). Results grid shows title, category, type, price, description.
- **TDD instructions**:
  1. Write `frontend/src/pages/PublicSearch.test.tsx` (RTL + vitest) covering: (a) submit disabled until key + image present; (b) on submit, calls `searchClient` with correct payload; (c) renders results grid on success; (d) renders error banner on failure; (e) low-confidence meta shows a banner above results.
  2. Write `frontend/src/lib/api/searchClient.test.ts` covering: (a) attaches `x-api-key` header; (b) builds multipart body; (c) parses `ApiError` shape on non-2xx.
  3. Confirm fail.
  4. Implement.
- **Subagent prompt**:
  > You are implementing Task T8 of plan `initial-e2e`. Read `AGENTS.md` and `plans/initial-e2e.md` first. Your goal: ship the public search page and supporting components, the typed search client, and the API-key context. No styling beyond what's needed for clarity (plain CSS or a single tiny stylesheet). API key never persists (no localStorage, no sessionStorage). Follow the TDD instructions. Do not touch backend code. Report: files changed, tests added, tests passing, anything outside scope (don't fix it, just flag it).

### Task T9 — End-to-end smoke + README polish
- **Goal**: Prove the slice actually works against the real DB and a real OpenAI key; capture the run instructions.
- **Entrypoints**:
  - `backend/test/e2e/search.e2e.test.ts` (new) — guarded by env, skipped unless `RUN_E2E=1`
  - `README.md` (modify) — add "Run a search" section, env vars, troubleshooting
  - `CHANGELOG.md` (new) — initial entry per the challenge's deliverables
- **Inputs**: All prior tasks.
- **Outputs**: One executable smoke test hitting Mongo + OpenAI behind the env guard; updated README; initial CHANGELOG entry.
- **TDD instructions**:
  1. Write the e2e test first: a fixture image (small JPEG checked into `backend/test/fixtures/`), a real network call when `RUN_E2E=1` and `OPENAI_API_KEY`/`MONGO_URI` set, asserting `results.length > 0` and `meta.stagesRan` includes the expected stages.
  2. With env unset, the test skips cleanly.
  3. Run `docker compose up`, perform a real search through the UI, screenshot or describe the result in a brief PR note.
- **Subagent prompt**:
  > You are implementing Task T9 of plan `initial-e2e`. Read `AGENTS.md` and `plans/initial-e2e.md` first. Your goal: add an env-guarded e2e smoke test, update `README.md` with the full run flow, and create an initial `CHANGELOG.md` entry summarizing the e2e slice. Use a small JPEG fixture under `backend/test/fixtures/`. Do not modify production code. Report: files changed, tests added, manual smoke result, anything outside scope.

## Dependency graph

```
T0 (DB discovery) ──┬──► T2 (shared wire types) ──┬──► T3 (provider) ──┐
                    │                              │                    │
                    └──► T4 (catalog) ─────────────┤                    │
                                                   │                    ├──► T6 (pipeline) ──► T7 (API) ──┐
T1 (scaffold) ─────────────────────────────────────┤                    │                                 │
                                                   └──► T5 (config+metrics) ──┘                           │
                                                                                                          │
                                                                          T8 (frontend, parallel from T2) ┤
                                                                                                          │
                                                                                                          ▼
                                                                                                       T9 (e2e + README)
```

## Parallel execution strategy

- **Wave 1** (parallel): **T0**, **T1** — discovery and scaffolding are independent.
- **Wave 2** (parallel): **T2** (depends on T0's `Product` type), **T5** (depends only on T1).
- **Wave 3** (parallel): **T3**, **T4**, **T8** — providers, catalog, and frontend can all proceed once shared types exist (T8 can mock the backend behind the typed client).
- **Wave 4**: **T6** — pipeline orchestrator wires T3+T4+T5.
- **Wave 5**: **T7** — API handler wires T6.
- **Wave 6**: **T9** — e2e smoke + README + CHANGELOG.

## Verification

`/execute` confirms completion by checking:

1. **Files exist** at every entrypoint listed above.
2. **`shared/`, `backend/`, `frontend/` build cleanly**: `tsc --noEmit` passes in each package.
3. **All unit tests green**: `npm test` from `backend/` and `frontend/`; `vitest` in `shared/`.
4. **Boot test**: `docker compose up -d` succeeds; `curl localhost:3001/health` returns `{ ok: true }`; `curl localhost:5173` returns the SPA HTML.
5. **Manual smoke**: with `.env` populated and an OpenAI key pasted in the UI, an upload of `backend/test/fixtures/*.jpg` returns ≥1 product in the grid and `meta.stagesRan` includes `visionExtract`, `queryBuild`, `catalogSearch`.
6. **Secrets hygiene**: `.env` is gitignored; `grep -ri "x-api-key" backend/src` shows the header is read but never logged; `git log -p` for the branch contains no real key.
7. **CHANGELOG.md** has an entry describing the e2e slice with motivation.
