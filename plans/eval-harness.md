# Plan: Eval harness + per-query diagnostic panel

## Spec
Two artifacts that together let us measure and inspect search quality. (1) A **per-query diagnostic panel**: backend returns `tokens` and `costUsd` in `SearchResponse.meta`; frontend renders a collapsible dev panel under results showing extracted attributes, built query, top-3 raw scores, stage latencies, tokens, $. (2) A **runnable eval harness** (`npm run eval` from `backend/`): loads a frozen gold set of 30 generated images (2 per category × 15 categories, stratified by type) with ground-truth product IDs and attribute sidecars, runs each through `runPipeline`, scores recall@1/5/20 + MRR + category/type/attribute hits + latency + tokens + $, prints a per-category breakdown to stdout, and appends one row to `backend/eval/history.jsonl`. Plus a small manual-curated subset of ~10 real-world photos for human eyeballing — not scored. Eval is local-only, env-guarded by `OPENAI_API_KEY` + `MONGO_URI`.

## Out of scope
- Admin UI to render `history.jsonl` (later plan)
- LLM-as-judge relevance scoring (only mechanical metrics)
- Precision / F1 / NDCG (recall@K + MRR is sufficient at this scale)
- A/B harness comparing two configs in one run (run twice, diff the JSONL rows manually)
- CI integration (eval is local-only, hits paid APIs)
- Regenerating the gold set from scratch in CI (fixtures are frozen and committed)
- Provider-side cost calc for non-OpenAI providers (only one adapter ships)
- Auth / gating around `?debug=1` (panel is dev-only via Vite flag)

## Architecture touchpoints
Per AGENTS.md §3 (`backend/eval/` is a named layer) and §5 (eval is "runnable standalone").

- **Provider layer** (modify, AGENTS.md §5):
  - `backend/src/providers/pricing.ts` (new) — `(model, promptTokens, completionTokens) → costUsd`. Hard-coded rate table.
  - `backend/src/providers/types.ts` (modify) — extend `Provider.extractFromImage` return to include `usage: { promptTokens, completionTokens, model }`.
  - `backend/src/providers/openai.ts` (modify) — populate `usage` from SDK response.
- **Pipeline layer** (modify):
  - `backend/src/pipeline/visionExtract.ts` (modify) — propagate provider `usage` upward.
  - `backend/src/pipeline/run.ts` (modify) — aggregate `usage` across stages, compute `costUsd` via pricing table, attach to `SearchResponse.meta`.
- **Shared wire types** (modify):
  - `shared/src/wire.ts` (modify) — extend `SearchResponse.meta` with `tokens: { prompt, completion, total }` and `costUsd: number`. Also include `topResults: Array<{ id, score }>` (top 3, raw) for the diag panel.
- **Frontend** (new + modify):
  - `frontend/src/components/DiagPanel.tsx` (new)
  - `frontend/src/pages/PublicSearch.tsx` (modify) — render `<DiagPanel>` when `import.meta.env.DEV`
  - `README.md` (modify) — document the dev-mode diag panel
- **Eval module** (all new, lives at `backend/eval/`):
  - `backend/eval/fixtures/gold/` — 30 JPEGs + 30 sidecar JSON files, committed
  - `backend/eval/fixtures/manual/` — ~10 JPEGs + `ATTRIBUTION.md`, committed
  - `backend/eval/scripts/sample-products.ts` (new) — stratified sampler from Mongo
  - `backend/eval/scripts/generate-gold.ts` (new) — calls gpt-image-1, writes JPEGs
  - `backend/eval/scripts/extract-gold-attrs.ts` (new) — calls gpt-4o-mini, writes sidecars
  - `backend/eval/scripts/fetch-manual.ts` (new) — downloads stock photos, writes attribution
  - `backend/eval/runner.ts` (new) — loads gold set, drives `runPipeline`, collects per-item rows
  - `backend/eval/scorer.ts` (new) — pure functions: recall@K, MRR, hits, Jaccard, aggregates
  - `backend/eval/reporter.ts` (new) — pretty stdout table + appends to `history.jsonl`
  - `backend/eval/types.ts` (new) — `GoldItem`, `EvalRow`, `EvalReport`, `HistoryRow`
  - `backend/eval/index.ts` (new) — `npm run eval` entrypoint
  - `backend/eval/history.jsonl` — append-only, committed (or `.gitkeep` if empty)
  - `backend/package.json` (modify) — add `"eval": "tsx eval/index.ts"` script + `"gold:sample"`, `"gold:generate"`, `"gold:attrs"`, `"manual:fetch"` scripts
- **Test fixtures**: each task that touches a stage uses `mongodb-memory-server` + mocked provider, consistent with initial-e2e tests.

## Tasks

### Task E1 — Provider pricing table + usage propagation
- **Goal**: Make the OpenAI adapter return token counts and a model identifier; add a hard-coded pricing table; make the pipeline aggregate cost per request.
- **Entrypoints**:
  - `backend/src/providers/pricing.ts` (new)
  - `backend/src/providers/pricing.test.ts` (new)
  - `backend/src/providers/types.ts` (modify — extend `extractFromImage` return type)
  - `backend/src/providers/openai.ts` (modify — populate `usage` from SDK)
  - `backend/src/providers/openai.test.ts` (modify — assert usage propagates)
- **Inputs**: Existing `Provider` interface from initial-e2e T3.
- **Outputs**:
  - `pricing.ts` exports `priceFor(model: string, promptTokens: number, completionTokens: number): number` returning USD. Rates table covers `gpt-4o-mini`, `gpt-4o`, `gpt-image-1` (price per image, separate function `priceForImage(model, count)`).
  - Provider return type now `{ extracted: ExtractedAttributes; usage: { promptTokens: number; completionTokens: number; model: string } }`.
- **TDD instructions**:
  1. Write `backend/src/providers/pricing.test.ts` covering: known model returns expected USD to 6 decimals; unknown model throws `UnknownModelError`; zero tokens → 0; image pricing returns flat per-image rate.
  2. Extend `backend/src/providers/openai.test.ts`: mock SDK response with `usage` field; assert returned object includes `usage.promptTokens`, `usage.completionTokens`, `usage.model`.
  3. Confirm tests fail.
  4. Implement. Pricing table values come from public OpenAI rate cards; document the date in a comment line at top of `pricing.ts`.
  5. Re-read diff: confirm pricing values are clearly sourced and dated; confirm no API key leakage in usage payload.
- **Subagent prompt**:
  > You are implementing Task E1 of plan `eval-harness`. Read `AGENTS.md` and `plans/eval-harness.md` first. Your goal: add `backend/src/providers/pricing.ts` with `priceFor` and `priceForImage` functions backed by a hard-coded rate table; extend the `Provider` interface return type to include `usage: { promptTokens, completionTokens, model }`; update the OpenAI adapter to populate `usage` from the SDK response. Touch only the entrypoints listed in the task. Follow the TDD instructions. Do not modify pipeline, API, or eval code — that's other tasks. Report: files changed, tests added, tests passing, anything outside scope (don't fix it, just flag it).

### Task E2 — Wire-format meta extension
- **Goal**: Extend `SearchResponse.meta` with `tokens`, `costUsd`, and `topResults` so the diag panel and eval runner have everything they need.
- **Entrypoints**:
  - `shared/src/wire.ts` (modify)
  - `shared/src/wire.test.ts` (modify)
- **Inputs**: Existing types from initial-e2e T2.
- **Outputs**: `SearchResponse.meta` now includes:
  - `tokens: { prompt: number; completion: number; total: number }`
  - `costUsd: number`
  - `topResults: Array<{ productId: string; score: number }>` — top 3 raw catalog hits before any rerank
  - existing fields preserved: `latencyMs`, `stagesRan`, `extracted`, optional `lowConfidence`
- **TDD instructions**:
  1. Extend `shared/src/wire.test.ts`: a fixture with the new meta fields type-checks; a fixture missing `tokens` produces a `// @ts-expect-error`; `topResults` accepts an empty array.
  2. Confirm fail.
  3. Implement (type-only changes).
- **Subagent prompt**:
  > You are implementing Task E2 of plan `eval-harness`. Read `AGENTS.md` and `plans/eval-harness.md` first. Your goal: extend `SearchResponse.meta` in `shared/src/wire.ts` with `tokens`, `costUsd`, and `topResults` (top-3 raw catalog scores). Touch only `shared/src/wire.ts` and `shared/src/wire.test.ts`. Follow the TDD instructions. Do not change unrelated types. Report: files changed, tests added, tests passing, anything outside scope.

### Task E3 — Pipeline aggregates cost + top-3 scores
- **Goal**: `runPipeline` populates the new meta fields by summing provider usage and exposing the top-3 raw catalog scores.
- **Entrypoints**:
  - `backend/src/pipeline/visionExtract.ts` (modify — return `usage` alongside attributes)
  - `backend/src/pipeline/catalogSearch.ts` (modify — return `topRaw: Array<{ productId, score }>` for the top 3 before slicing to topK)
  - `backend/src/pipeline/run.ts` (modify — aggregate usage, compute costUsd, attach topResults)
  - `backend/src/pipeline/run.test.ts` (modify)
- **Inputs**: E1's pricing + provider usage; E2's wire types.
- **Outputs**: `runPipeline` result's `meta` populated with `tokens`, `costUsd`, `topResults`. No behavior change for upstream callers other than the meta payload.
- **TDD instructions**:
  1. Extend `backend/src/pipeline/run.test.ts`: with mocked provider returning `usage: { promptTokens: 100, completionTokens: 50, model: 'gpt-4o-mini' }` and a mocked `searchCatalog` returning 5 products with descending scores, assert: `meta.tokens.total === 150`; `meta.costUsd` matches `priceFor('gpt-4o-mini', 100, 50)`; `meta.topResults` has length 3 in score-descending order; existing assertions still pass.
  2. Stage tests: extend `visionExtract.test.ts` to assert `usage` propagates; extend `catalogSearch.test.ts` to assert `topRaw` returned.
  3. Confirm fail.
  4. Implement. `costUsd` calc lives in `run.ts` (not in stages) so the orchestrator owns the aggregation.
- **Subagent prompt**:
  > You are implementing Task E3 of plan `eval-harness`. Read `AGENTS.md` and `plans/eval-harness.md` first. Your goal: extend the pipeline so `runPipeline` returns `meta.tokens`, `meta.costUsd`, and `meta.topResults`. Touch only `backend/src/pipeline/visionExtract.ts`, `catalogSearch.ts`, `run.ts`, and their `.test.ts` siblings. Follow the TDD instructions. Do not touch providers, API, or eval code. Report: files changed, tests added, tests passing, anything outside scope.

### Task E4 — Frontend diag panel (dev-only)
- **Goal**: Render a collapsible diagnostic panel beneath search results when running in Vite dev mode. Document it in the README.
- **Entrypoints**:
  - `frontend/src/components/DiagPanel.tsx` (new)
  - `frontend/src/components/DiagPanel.test.tsx` (new)
  - `frontend/src/pages/PublicSearch.tsx` (modify — conditionally render)
  - `frontend/src/pages/PublicSearch.test.tsx` (modify)
  - `README.md` (modify — add "Dev-mode diagnostic panel" subsection)
- **Inputs**: E2's extended `SearchResponse.meta`.
- **Outputs**: `<DiagPanel meta={meta} />` rendering: extracted attributes (key/value list), built query string, top-3 results (id + score), stage latencies (ms per stage), tokens (prompt/completion/total), `costUsd` formatted to 5 decimals. Collapsible via a `<details>` element. Rendered only when `import.meta.env.DEV` is truthy.
- **TDD instructions**:
  1. Write `frontend/src/components/DiagPanel.test.tsx` covering: renders all sections given a fixture meta; renders nothing crash-y when `topResults` is empty; latencies render in the order returned by `stagesRan`.
  2. Extend `frontend/src/pages/PublicSearch.test.tsx`: with `import.meta.env.DEV === true`, panel appears after a successful search; with it `false`, panel is absent. (Use `vi.stubEnv` or a small env shim.)
  3. Confirm fail.
  4. Implement. Plain HTML + minimal CSS; no extra deps.
  5. Add a short "Dev-mode diagnostic panel" subsection to README explaining: appears under results when running `npm run dev` (Vite dev mode); does not ship in production builds; surfaces extracted attrs / built query / top-3 raw scores / latencies / tokens / cost.
- **Subagent prompt**:
  > You are implementing Task E4 of plan `eval-harness`. Read `AGENTS.md` and `plans/eval-harness.md` first. Your goal: ship a dev-only diagnostic panel under search results plus a short README subsection. The panel renders only when `import.meta.env.DEV` is true. Touch only the entrypoints listed. Follow the TDD instructions. Do not modify backend code or any other frontend file. Report: files changed, tests added, tests passing, anything outside scope.

### Task E5 — Gold-set sampler + image-gen + attribute-extraction scripts
- **Goal**: Three scripts that, run in sequence on the developer's machine, produce the frozen 30-item gold set under `backend/eval/fixtures/gold/`.
- **Entrypoints**:
  - `backend/eval/scripts/sample-products.ts` (new)
  - `backend/eval/scripts/generate-gold.ts` (new)
  - `backend/eval/scripts/extract-gold-attrs.ts` (new)
  - `backend/eval/scripts/sample-products.test.ts` (new — pure logic test)
  - `backend/eval/scripts/extract-gold-attrs.test.ts` (new — mocked SDK)
  - `backend/package.json` (modify — add `gold:sample`, `gold:generate`, `gold:attrs` scripts)
- **Inputs**: Mongo (via `backend/src/catalog/`), OpenAI SDK, env (`MONGO_URI`, `MONGO_DB`, `MONGO_COLLECTION`, `OPENAI_API_KEY`).
- **Outputs**:
  - `sample-products.ts`: stratified sampler. For each of 15 categories, picks 2 products with **different `type` values** (falls back to 2 random if a category has only one type). Writes `backend/eval/fixtures/gold/_sample.json` listing `{ productId, category, type, title, description }`.
  - `generate-gold.ts`: reads `_sample.json`, calls `gpt-image-1` with prompt `"Photo of a room featuring {description}"`, writes JPEGs as `{productId}.jpg`. Idempotent: skips files that already exist. Fails loud on API error.
  - `extract-gold-attrs.ts`: reads `_sample.json`, for each product calls `gpt-4o-mini` with `temperature: 0` and a JSON-schema response of `{ color, material, style }` (each `string[]`), writes sidecar `{productId}.json` with shape `{ productId, category, type, title, description, color, material, style }`.
  - `package.json` scripts: `gold:sample`, `gold:generate`, `gold:attrs` (each calls `tsx` on the corresponding script).
- **TDD instructions**:
  1. Write `sample-products.test.ts`: pure stratification function `pickStratified(products, perCategory): Sample[]` — given a fixture array, asserts (a) 2 per category, (b) different `type` values when possible, (c) deterministic given a seed.
  2. Write `extract-gold-attrs.test.ts` mocking the OpenAI SDK: asserts schema-shaped response is parsed; asserts API key never appears in stringified errors; asserts `temperature: 0` is set.
  3. Confirm fail.
  4. Implement. Scripts have a small CLI (`tsx eval/scripts/X.ts`) and read `.env` directly.
  5. Re-read diff: confirm scripts do not commit any real API keys; confirm they fail loud when env is missing rather than silently writing partial fixtures.
- **Subagent prompt**:
  > You are implementing Task E5 of plan `eval-harness`. Read `AGENTS.md` and `plans/eval-harness.md` first. Your goal: ship three eval-fixture-generation scripts under `backend/eval/scripts/` plus their `package.json` script entries. The user will run them once on their machine and commit the resulting fixtures (not your job). Stratification picks 2 per category preferring different `type` values. Image gen via `gpt-image-1`; attribute extraction via `gpt-4o-mini` at `temperature: 0`. Touch only the listed entrypoints. Follow the TDD instructions. Do not call OpenAI in tests — mock the SDK. Do not generate or commit any fixture content; that's a manual step the user does after this task lands. Report: files changed, tests added, tests passing, anything outside scope.

### Task E6 — Manual subset fetch script + attribution
- **Goal**: A small script that downloads ~10 public-domain room photos from Unsplash/Pexels-style URLs into `backend/eval/fixtures/manual/` with an `ATTRIBUTION.md` file. Fetched once, committed.
- **Entrypoints**:
  - `backend/eval/scripts/fetch-manual.ts` (new)
  - `backend/eval/scripts/fetch-manual.test.ts` (new)
  - `backend/eval/fixtures/manual/ATTRIBUTION.md` (new — placeholder template, real entries added when user runs the script)
  - `backend/package.json` (modify — add `manual:fetch` script)
- **Inputs**: A hard-coded list inside the script of ~10 `{ url, photographer, source, license }` entries pointing to permissively-licensed images (Unsplash License, Pexels License, or CC0).
- **Outputs**: Script downloads each URL to `manual/<index>.jpg` and writes an `ATTRIBUTION.md` listing photographer/source/license per file. Idempotent.
- **TDD instructions**:
  1. Write `fetch-manual.test.ts`: mocks `fetch`, asserts each URL is downloaded once, asserts `ATTRIBUTION.md` content is generated from the entry list, asserts skipping already-present files.
  2. Confirm fail.
  3. Implement. Selection of URLs: pick 10 well-lit interior/furniture photos from Unsplash with explicit Unsplash License (free to use, attribution appreciated). Document each entry in code with the source URL.
  4. Re-read diff: confirm licenses listed are actually permissive; flag any uncertainty rather than guessing.
- **Subagent prompt**:
  > You are implementing Task E6 of plan `eval-harness`. Read `AGENTS.md` and `plans/eval-harness.md` first. Your goal: a `tsx`-runnable script that downloads ~10 public-domain interior/furniture photos into `backend/eval/fixtures/manual/` and writes an `ATTRIBUTION.md`. Pick photos with **explicit permissive licenses only** (Unsplash License, Pexels License, CC0). If you are uncertain about a license, do not include the photo — flag it in the report. Touch only the listed entrypoints. Follow the TDD instructions. The user will run the script once and commit the resulting JPEGs. Report: files changed, tests added, tests passing, the curated URL list with licenses, anything outside scope.

### Task E7 — Eval scorer (pure functions)
- **Goal**: Pure scoring functions with no I/O — the testable core of the eval harness.
- **Entrypoints**:
  - `backend/eval/types.ts` (new)
  - `backend/eval/scorer.ts` (new)
  - `backend/eval/scorer.test.ts` (new)
- **Inputs**: From E2/E3 (`SearchResponse`); `GoldItem` defined in `types.ts`.
- **Outputs**:
  - `types.ts` exports: `GoldItem { productId, category, type, title, description, color: string[], material: string[], style: string[] }`; `EvalRow { goldItem, response, scores }`; `EvalReport { overall, byCategory, runs: EvalRow[] }`; `HistoryRow` (per the agreed JSONL schema).
  - `scorer.ts` exports pure functions:
    - `recallAtK(targetId, results, k): 0|1`
    - `reciprocalRank(targetId, results): number` (0 if not present)
    - `categoryHit(extracted, gold): boolean`
    - `typeHit(extracted, gold): boolean`
    - `attributeOverlap(extracted, gold): number` (Jaccard on union of `{color, material, style}`, 0 if both sides empty)
    - `aggregate(rows: EvalRow[]): EvalReport['overall']` — recall@1/5/20, MRR, hit rates, mean attributeOverlap, p50/p95 latency, total tokens, total $, failure-mode counts
    - `aggregateByCategory(rows: EvalRow[]): EvalReport['byCategory']`
- **TDD instructions**:
  1. Write `scorer.test.ts` covering: `recallAtK` boundary cases (target at rank 1 / rank K / rank K+1 / absent); `reciprocalRank` (1 / 1/K / 0); `attributeOverlap` (full match → 1, no overlap → 0, both empty → 0, partial → expected Jaccard); `aggregate` over a fixed 5-row fixture matches hand-computed values; p95 with n=5 returns the expected element.
  2. Confirm fail.
  3. Implement. No file I/O, no network, no Mongo, no SDK.
- **Subagent prompt**:
  > You are implementing Task E7 of plan `eval-harness`. Read `AGENTS.md` and `plans/eval-harness.md` first. Your goal: ship `backend/eval/types.ts` and `backend/eval/scorer.ts` as pure modules — no I/O, no SDK, no Mongo. Functions and types listed in the task. Touch only the listed entrypoints. Follow the TDD instructions. Report: files changed, tests added, tests passing, anything outside scope.

### Task E8 — Eval runner + reporter + history.jsonl
- **Goal**: The `npm run eval` entrypoint. Loads gold fixtures, calls `runPipeline` per item, scores via E7, prints a stdout report, appends a row to `history.jsonl`. Env-guarded — skips with a clear message if `OPENAI_API_KEY` or `MONGO_URI` is missing.
- **Entrypoints**:
  - `backend/eval/runner.ts` (new) — `runEval(deps): Promise<EvalReport>`
  - `backend/eval/reporter.ts` (new) — `printReport(report)`, `appendHistory(report, configSnapshot, gitSha)`
  - `backend/eval/index.ts` (new) — CLI entry; reads env, wires deps, calls runner + reporter
  - `backend/eval/runner.test.ts` (new)
  - `backend/eval/reporter.test.ts` (new)
  - `backend/eval/fixtures/gold/.gitkeep` (new) — preserves dir before fixtures land
  - `backend/eval/fixtures/manual/.gitkeep` (new)
  - `backend/eval/history.jsonl` (new — empty file, committed)
  - `backend/package.json` (modify — add `"eval": "tsx eval/index.ts"` script)
  - `README.md` (modify — add "## Eval" section with run instructions and env requirements)
- **Inputs**: E2/E3 (`runPipeline`, extended meta), E7 (scorer, types), the gold fixtures (paths only — content lands manually after E5).
- **Outputs**:
  - `runner.ts`: takes `deps: { runPipeline, loadGold, getConfig }`, iterates gold items, calls pipeline, builds `EvalRow[]`, returns `EvalReport`. Pure orchestration; deps injected.
  - `reporter.ts`:
    - `printReport(report)`: stdout table — overall metrics row + per-category rows. Plain ASCII, no extra deps.
    - `appendHistory(report, config, gitSha)`: writes one JSON line to `backend/eval/history.jsonl` matching the agreed schema (`ts`, `gitSha`, `gitDirty`, `config`, `goldSetVersion`, `n`, `metrics`, `byCategory`).
  - `index.ts`: env-guard; reads `git rev-parse HEAD` + `git status --porcelain` for `gitSha`/`gitDirty`; `goldSetVersion` read from a constant in the file (start at `"v1"`); calls `runEval` then `printReport` + `appendHistory`.
  - README "## Eval" section: prerequisites, `npm run gold:sample && gold:generate && gold:attrs && manual:fetch` once, then `npm run eval`; describes the output and `history.jsonl` location.
- **TDD instructions**:
  1. Write `runner.test.ts`: with fake `loadGold` returning 2 fixture items + mocked `runPipeline` returning a deterministic response, assert `EvalReport.overall.recallAt5` matches the expected value and `byCategory` contains both categories.
  2. Write `reporter.test.ts`:
     - `appendHistory` writes exactly one valid JSON line to a tmp file; second call appends without truncating the first.
     - History line includes all required fields per schema; `goldSetVersion` defaults to `"v1"`.
     - `printReport` output contains `recall@5`, the per-category section header, and a $ figure (string-match assertions; don't snapshot the whole table).
  3. Confirm fail.
  4. Implement. `index.ts` skips with exit 0 + clear stderr message when env is missing — does not crash.
  5. Re-read diff: confirm `history.jsonl` is appended to (not overwritten); confirm OpenAI key never appears in any logged line, including error paths.
- **Subagent prompt**:
  > You are implementing Task E8 of plan `eval-harness`. Read `AGENTS.md` and `plans/eval-harness.md` first. Your goal: implement the eval runner, the stdout reporter, the JSONL history writer, and the `npm run eval` CLI entrypoint, plus a README "## Eval" section. The runner depends on E7's scorer/types and on `runPipeline` from initial-e2e T6. Inject all I/O so the runner is unit-testable without hitting OpenAI or Mongo. Env-guard the CLI: missing `OPENAI_API_KEY` or `MONGO_URI` exits 0 with a clear stderr message. Touch only the listed entrypoints. Follow the TDD instructions. Do not implement gold-set generation (E5) or manual fetch (E6) — only consume the fixtures via path. Report: files changed, tests added, tests passing, anything outside scope.

## Dependency graph

```
E1 (provider pricing + usage) ──┐
                                 ├──► E3 (pipeline aggregates) ──► E4 (frontend diag panel)
E2 (wire meta extension) ───────┤                              │
                                 │                              └──► E8 (runner + reporter)
                                 │                              ▲
E5 (gold-set scripts) ───────────┴──► fixtures (manual step) ───┘
                                                                ▲
E6 (manual fetch) ──────────────────► fixtures (manual step) ───┤
                                                                │
E7 (scorer pure fns) ───────────────────────────────────────────┘
```

Notes:
- E5 and E6 ship **scripts** only; the user runs them once and commits resulting fixtures. E8 reads fixtures by path, so it doesn't block on fixture content existing — its tests use injected fakes.
- E2 has no runtime cost; it gates E3 and E4 because both consume the new types.

## Parallel execution strategy

- **Wave 1** (parallel): **E1**, **E2**, **E5**, **E6**, **E7** — all five are independent.
  - E1: provider layer.
  - E2: shared types.
  - E5: eval scripts (no dependency on extended types — operates on raw products + image gen).
  - E6: manual fetch script (entirely standalone).
  - E7: pure scorer (depends only on `Product` from initial-e2e T0 and types it defines itself).
- **Wave 2** (parallel): **E3**, **E4** (E4 depends on E2 only; can run in parallel with E3 since they touch disjoint files).
  - E3: pipeline aggregates (needs E1 + E2).
  - E4: frontend diag panel (needs E2).
- **Wave 3**: **E8** — runner + reporter + CLI (needs E2, E3, E7).
- **Manual step** (post-execute, by user): run `npm run gold:sample && gold:generate && gold:attrs && manual:fetch` once, eyeball the fixtures, commit them.

## Verification

`/execute` confirms completion by checking:

1. **Files exist** at every entrypoint listed above (including new test files and `history.jsonl` empty placeholder).
2. **Type-check clean**: `tsc --noEmit` passes in `backend/`, `frontend/`, and `shared/`.
3. **All unit tests green**:
   - `backend/`: `npm test` covers pricing, providers (extended), pipeline (extended), scorer, runner, reporter, eval scripts (with mocked SDK / fetch).
   - `frontend/`: `npm test` covers `DiagPanel` and the dev-flag conditional render.
   - `shared/`: `vitest` covers extended `wire.ts` types.
4. **No real network in tests**: `grep -r "openai" backend/eval/scripts/*.test.ts backend/src/providers/*.test.ts` shows mocks only.
5. **Pricing sanity**: `pricing.ts` rate table values are clearly sourced and dated in a header comment.
6. **Wire compatibility**: `SearchResponse.meta` includes `tokens`, `costUsd`, `topResults`; existing fields (`latencyMs`, `stagesRan`, `extracted`) preserved.
7. **Diag panel gating**: `frontend/src/pages/PublicSearch.tsx` checks `import.meta.env.DEV` (string match) before rendering `<DiagPanel>`.
8. **README**: contains a "## Eval" section and a "Dev-mode diagnostic panel" subsection.
9. **History append-only**: `appendHistory` test asserts second call preserves the first line; `history.jsonl` exists as an empty committed file.
10. **Secrets hygiene**: `grep -ri "x-api-key\|OPENAI_API_KEY" backend/eval backend/src/providers` shows reads only, never logs / never stringifies into errors.
11. **Manual fixtures**: `backend/eval/fixtures/manual/ATTRIBUTION.md` exists (template form is acceptable until the user runs `manual:fetch`); the script's curated URL list documents license per entry.
12. **CLI guard**: running `npm run eval` with no env exits 0 and prints a "skipping — set OPENAI_API_KEY and MONGO_URI" message to stderr.
