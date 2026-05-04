# Plan: Admin UI

## Spec
A small admin surface for tuning the retrieval pipeline at runtime and inspecting historical eval performance, plus the long-promised LLM rerank stage that the seam in `pipeline/rerank.ts` was built for. Backend persists `Config` to disk so changes survive restart, exposes admin-only HTTP routes guarded by an `ADMIN_PASSWORD` env (default `"admin"`), and adds a vision-prompt knob plus three rerank knobs to `Config` (`rerank`, `rerankModel`, `rerankPrompt`, `rerankTopN`) plumbed through the provider. Frontend gains a `/admin` route (via `react-router-dom`) with a password gate, a config form covering all knobs (with reset-to-defaults), and a read-only history table sourced from `backend/eval/history.jsonl`. Pipeline reads config per-request — config edits take effect on the next search with no restart. Rerank ships **on by default**: an image-attached, reorder-only LLM pass over the top-N candidates that returns a permuted id list, with provider usage aggregated into the existing `meta.tokens` / `meta.costUsd` so eval and the diag panel pick it up for free.

## Out of scope
- Real auth (sessions, OAuth, multi-user) — single shared static password only
- Admin user management, audit logs of who changed what
- Charts / graphs over `history.jsonl` — table view only
- Triggering an eval run from the admin UI (eval stays local CLI per eval-harness plan)
- Exposing the `provider` knob (only one provider value exists today)
- Editing prompt templates other than the vision and rerank system prompts
- Migrating existing `config/store.ts` callers — they keep using `getConfig()` unchanged
- Concurrency control across multiple backend processes (single-process deployment)
- Hot-reloading config from external file edits — disk is a write-through cache, the in-memory store is authoritative within a process
- Rerank that **drops** candidates (truncation / filtering). Reorder-only — output id set must equal input id set
- Cost ceilings or auto-disable on rerank spend — the admin toggle is the only guard
- A "Reranking…" UI substate — the existing single spinner covers the longer total latency
- Passing per-result rationale strings back to the UI (rerank returns ids only)

## Architecture touchpoints
Per AGENTS.md §5 (`config/` is "in-memory store; single source of truth read by pipeline" — we extend it to be file-backed) and §8 ("Admin isolation: public surface and admin surface are distinguishable at the route and API level").

- **Backend config** (modify):
  - `backend/src/config/store.ts` — extend `Config` with `visionPrompt`; add file-backed load/save; add `validateConfig`; add `resetConfig` semantics that clear the file too.
  - `backend/src/config/store.test.ts` — extend.
  - `backend/data/config.json` — runtime-mutable store (gitignored).
  - `backend/.gitignore` (modify or new) — ignore `data/`.
- **Backend admin layer** (new):
  - `backend/src/api/admin/auth.ts` (new) — `requireAdminPassword` middleware reading `ADMIN_PASSWORD` (default `"admin"`).
  - `backend/src/api/admin/auth.test.ts` (new)
  - `backend/src/api/admin/routes.ts` (new) — `registerAdminRoutes(app)` mounting `GET /admin/config`, `POST /admin/config`, `POST /admin/config/reset`, `GET /admin/history`.
  - `backend/src/api/admin/routes.test.ts` (new)
  - `backend/src/app.ts` (modify) — call `registerAdminRoutes(app)`.
- **Pipeline + provider** (modify, AGENTS.md §5):
  - `backend/src/providers/types.ts` (modify) — add `systemPrompt: string` to `ExtractFromImageInput`; add new `RerankWithImageInput`, `RerankWithImageResult` types and the optional `rerankWithImage` method on `Provider`.
  - `backend/src/providers/openai.ts` (modify) — replace hardcoded `SYSTEM_PROMPT` literal with `input.systemPrompt`; implement `rerankWithImage` (image + candidate JSON list → ordered id array via `json_schema` response).
  - `backend/src/providers/openai.test.ts` (modify) — assert vision prompt threaded through; assert rerank call shape (image attached, candidates serialized, model + prompt threaded, returned ids parsed).
  - `backend/src/pipeline/visionExtract.ts` (modify) — accept `visionPrompt` in deps, forward to provider.
  - `backend/src/pipeline/visionExtract.test.ts` (modify) — assert prompt forwarded.
  - `backend/src/pipeline/rerank.ts` (modify) — replace stub passthrough with real implementation: take top-N candidates, call `provider.rerankWithImage`, defensively reorder (fall back to input order if returned ids mismatch); aggregate `usage` upward.
  - `backend/src/pipeline/rerank.test.ts` (modify) — assert reorder happens, mismatch fallback, top-N slicing, usage propagation, no-op when disabled.
  - `backend/src/pipeline/run.ts` (modify) — pass `config.visionPrompt` into `visionExtract` deps; thread `input.image` + `input.mimeType` + `config.rerankModel` + `config.rerankPrompt` + `config.rerankTopN` into `rerank` deps; aggregate rerank's `usage` into the existing token/cost sums.
  - `backend/src/pipeline/run.test.ts` (modify) — assert prompts threaded from config; with rerank enabled, mocked provider.rerankWithImage is called with the image buffer and candidates, returned order is honored, and rerank tokens roll up into `meta.tokens.total` / `meta.costUsd`.
- **Shared wire types** (modify):
  - `shared/src/wire.ts` (modify) — add `AdminConfig`, `AdminConfigUpdate`, `HistoryRow`, `HistoryResponse`. Re-export the eval-harness `HistoryRow` shape so frontend doesn't import from `backend/eval`.
  - `shared/src/wire.test.ts` (modify).
- **Frontend** (new + modify):
  - `frontend/package.json` (modify) — add `react-router-dom`.
  - `frontend/src/App.tsx` (modify) — wrap in `<BrowserRouter>`, add `<Routes>` for `/` and `/admin`.
  - `frontend/src/App.test.tsx` (modify) — verify routing.
  - `frontend/src/pages/Admin.tsx` (new) — composes login gate + tabbed Config/History view.
  - `frontend/src/pages/Admin.test.tsx` (new).
  - `frontend/src/components/AdminLogin.tsx` (new) — password form.
  - `frontend/src/components/AdminLogin.test.tsx` (new).
  - `frontend/src/components/AdminConfigForm.tsx` (new) — fields + save + reset.
  - `frontend/src/components/AdminConfigForm.test.tsx` (new).
  - `frontend/src/components/AdminHistoryTable.tsx` (new).
  - `frontend/src/components/AdminHistoryTable.test.tsx` (new).
  - `frontend/src/lib/state/adminAuth.tsx` (new) — sessionStorage-backed hook for the admin password.
  - `frontend/src/lib/state/adminAuth.test.tsx` (new).
  - `frontend/src/lib/api/adminClient.ts` (new) — typed wrappers for admin endpoints, sends `x-admin-password`.
  - `frontend/src/lib/api/adminClient.test.ts` (new).
  - `README.md` (modify) — short "Admin UI" subsection: route, env var, defaults.

## Tasks

### Task A1 — Config store: file-backed + visionPrompt + rerank knobs + validation + reset
- **Goal**: Extend `Config` with `visionPrompt` and three rerank knobs (`rerankModel`, `rerankPrompt`, `rerankTopN`), flip `rerank` default to `true`, persist the store to `backend/data/config.json` (atomic write, lazy bootstrap, corrupt-file fallback), and add a typed validator. Pipeline still calls `getConfig()` per request unchanged.
- **Entrypoints**:
  - `backend/src/config/store.ts` (modify)
  - `backend/src/config/store.test.ts` (modify)
  - `backend/.gitignore` (new or modify — ignore `data/`)
- **Inputs**: Existing `Config` shape (`topK`, `rerank`, `provider`, `visionModel`).
- **Outputs**:
  - `Config` extended:
    - `visionPrompt: string`
    - `rerank: boolean` — default flips from `false` to `true`
    - `rerankModel: string` — default `"gpt-4o-mini"`
    - `rerankPrompt: string` — default `DEFAULT_RERANK_PROMPT` (see below)
    - `rerankTopN: number` — default `10`; how many catalog hits the rerank stage receives. Note: this is independent of `topK` — pipeline slices `min(topK, rerankTopN)` for rerank input.
  - `DEFAULT_VISION_PROMPT` constant: a verbatim copy of the existing `SYSTEM_PROMPT` literal in `backend/src/providers/openai.ts`, with comment `// keep in sync — Task A5 deduplicates`.
  - `DEFAULT_RERANK_PROMPT` constant: a short instruction along the lines of `"You are a furniture-catalog reranker. Given a user-uploaded image and a JSON list of candidate products (id, title, description), return a JSON object { orderedIds: string[] } reordering the candidates from most to least visually relevant to the image. The output id set must exactly equal the input id set — do not drop, add, or invent ids."` — finalized by the implementer; documented as the default and editable from the admin UI.
  - `validateConfig(partial: unknown): { ok: true; value: Partial<Config> } | { ok: false; errors: string[] }` — pure function. Rules:
    - `topK` integer in `[1, 100]`
    - `rerank` boolean
    - `provider === "openai"`
    - `visionModel` non-empty string ≤ 200 chars
    - `visionPrompt` non-empty string ≤ 2000 chars
    - `rerankModel` non-empty string ≤ 200 chars
    - `rerankPrompt` non-empty string ≤ 2000 chars
    - `rerankTopN` integer in `[1, 50]`
    - Unknown keys rejected.
  - `setConfig(partial)` now also persists to disk (atomic: write `config.json.tmp`, `fs.rename`).
  - On module init: attempt to read `data/config.json`. If missing → defaults, no write. If unparseable / fails validation → `console.warn`, defaults, no write.
  - `resetConfig()` deletes `data/config.json` if present (best-effort; ignore `ENOENT`) and restores in-memory defaults.
  - Exports `CONFIG_FILE_PATH` (relative to `backend/`) so tests and the admin route can introspect.
  - Optional escape hatch for tests: `setConfigFilePath(path)` swaps the target path so unit tests can use `os.tmpdir()`.
- **TDD instructions**:
  1. Extend `store.test.ts` with cases (each in a tmp dir via `setConfigFilePath`):
     - default `Config` includes `visionPrompt === DEFAULT_VISION_PROMPT`, `rerankPrompt === DEFAULT_RERANK_PROMPT`, `rerank === true`, `rerankModel === "gpt-4o-mini"`, `rerankTopN === 10`
     - boot with no file → `getConfig()` returns defaults; no file is written
     - boot with valid file → values from file override defaults
     - boot with corrupt JSON → defaults returned, warning logged (spy on `console.warn`), no crash
     - boot with valid JSON but invalid values (e.g. `topK: -1` or `rerankTopN: 99`) → defaults returned, warning logged
     - `setConfig({ topK: 5 })` writes a file containing the merged config; second `setConfig({ rerank: false })` preserves the earlier `topK` on disk
     - `setConfig` with invalid value throws; disk file unchanged
     - `resetConfig()` removes the file; subsequent `getConfig()` returns defaults
     - `validateConfig({ topK: 0 })` returns `{ ok: false }`; `validateConfig({ topK: 50 })` returns `{ ok: true, value: { topK: 50 } }`; `validateConfig({ unknownKey: 1 })` returns `{ ok: false }`; `validateConfig({ rerankTopN: 51 })` returns `{ ok: false }`; `validateConfig({ rerankTopN: 5 })` returns `{ ok: true }`
  2. Confirm fail.
  3. Implement using `node:fs/promises` for write (atomic via `.tmp` + `rename`); `node:fs.readFileSync` is acceptable on boot since module init is sync. Default file path: `path.resolve(process.cwd(), "data/config.json")` — configurable via `setConfigFilePath`.
  4. Add `data/` to `backend/.gitignore`.
  5. Re-read diff: confirm no API key or password ever lands in the persisted JSON; confirm the file write is atomic (rename, not partial write).
- **Subagent prompt**:
  > You are implementing Task A1 of plan `admin-ui`. Read `AGENTS.md` and `plans/admin-ui.md` first. Your goal: extend `backend/src/config/store.ts` so `Config` includes `visionPrompt: string`, `rerankModel: string`, `rerankPrompt: string`, `rerankTopN: number`, with the defaults listed in the task (and `rerank` flipping to default `true`). Persist the store to `backend/data/config.json` (atomic write via tmp+rename, lazy bootstrap, corrupt-file fallback to defaults with a warning). Add a `validateConfig` pure function with the validation rules listed. Add `backend/data/` to `backend/.gitignore`. Touch only the entrypoints listed. Follow the TDD instructions. Do not modify pipeline, providers, or any admin route — those are other tasks. Define `DEFAULT_VISION_PROMPT` as a string constant matching the current `SYSTEM_PROMPT` in `backend/src/providers/openai.ts` (verbatim copy, with a `// keep in sync — Task A5 deduplicates` comment). Define `DEFAULT_RERANK_PROMPT` as a sensible reorder-only system prompt (see plan for the suggested wording). Report: files changed, tests added, tests passing, anything outside scope.

### Task A2 — Admin auth middleware
- **Goal**: Express middleware that gates a route by checking the `x-admin-password` header against `process.env.ADMIN_PASSWORD` (default `"admin"`). Constant-time compare. Never echoes the password.
- **Entrypoints**:
  - `backend/src/api/admin/auth.ts` (new)
  - `backend/src/api/admin/auth.test.ts` (new)
- **Inputs**: Express `Request`, `Response`, `NextFunction`.
- **Outputs**:
  - Default export: `requireAdminPassword: (req, res, next) => void`.
  - Helper: `getExpectedPassword(): string` (reads env, defaults to `"admin"`). Exported for testability.
  - On failure: respond `401` with `{ code: "ADMIN_AUTH_REQUIRED", message: "Admin password required." }` for missing header, `{ code: "ADMIN_AUTH_INVALID", message: "Invalid admin password." }` for wrong password. No response includes the password value.
  - On success: call `next()`.
- **TDD instructions**:
  1. Write `auth.test.ts` using `supertest` against a tiny inline app that mounts the middleware on a probe route:
     - missing header → `401` with `code: "ADMIN_AUTH_REQUIRED"`
     - wrong password → `401` with `code: "ADMIN_AUTH_INVALID"`; response body string-search confirms the supplied password value is **not** present
     - correct password → `200`
     - default password is `"admin"` when `ADMIN_PASSWORD` env is unset
     - custom password from env is honored when set
     - empty string env is rejected as "unset" (falls back to `"admin"`); document this in a comment
  2. Confirm fail.
  3. Implement. Use `crypto.timingSafeEqual` after length-padding both buffers (or short-circuit on length mismatch) to avoid timing leaks.
  4. Re-read diff: grep the file for any `console.log` of the supplied password. Confirm absent.
- **Subagent prompt**:
  > You are implementing Task A2 of plan `admin-ui`. Read `AGENTS.md` and `plans/admin-ui.md` first. Your goal: an Express middleware at `backend/src/api/admin/auth.ts` that gates routes by comparing the `x-admin-password` header to `process.env.ADMIN_PASSWORD` (default `"admin"`), using a constant-time compare. Touch only the listed entrypoints. Follow the TDD instructions. Do not register the middleware anywhere — that's Task A6. Report: files changed, tests added, tests passing, anything outside scope.

### Task A3 — Wire types: AdminConfig + HistoryRow
- **Goal**: Type-only additions in `shared/src/wire.ts` so frontend and backend agree on admin payload shapes without the frontend reaching into `backend/eval/types.ts`.
- **Entrypoints**:
  - `shared/src/wire.ts` (modify)
  - `shared/src/wire.test.ts` (modify)
- **Inputs**: Existing wire types; awareness of the eval-harness `HistoryRow` schema (from `plans/eval-harness.md` Task E8).
- **Outputs**:
  - `AdminConfig` — mirrors backend `Config` minus any future-secret fields: `{ topK: number; rerank: boolean; provider: "openai"; visionModel: string; visionPrompt: string; rerankModel: string; rerankPrompt: string; rerankTopN: number }`.
  - `AdminConfigUpdate = Partial<AdminConfig>`.
  - `HistoryRow` — `{ ts: string; gitSha: string; gitDirty: boolean; goldSetVersion: string; n: number; config: AdminConfig; metrics: { recallAt1: number; recallAt5: number; recallAt20: number; mrr: number; meanAttributeOverlap: number; categoryHitRate: number; typeHitRate: number; p50LatencyMs: number; p95LatencyMs: number; totalTokens: number; totalCostUsd: number; failureCounts: Record<string, number> }; byCategory: Record<string, Partial<HistoryRow["metrics"]>> }`.
  - `HistoryResponse = { rows: HistoryRow[] }`.
  - `AdminErrorCodes` (string union) including `ADMIN_AUTH_REQUIRED`, `ADMIN_AUTH_INVALID`, `ADMIN_CONFIG_INVALID`, `ADMIN_HISTORY_UNAVAILABLE`.
- **TDD instructions**:
  1. Extend `wire.test.ts` with type-level fixtures:
     - a fully-populated `HistoryRow` literal type-checks
     - a `HistoryRow` missing `metrics.recallAt5` produces a `// @ts-expect-error`
     - `AdminConfigUpdate` accepts `{ topK: 5 }` alone
     - `HistoryResponse` accepts `{ rows: [] }`
  2. Confirm fail.
  3. Implement (type-only).
- **Subagent prompt**:
  > You are implementing Task A3 of plan `admin-ui`. Read `AGENTS.md`, `plans/admin-ui.md`, and `plans/eval-harness.md` (Task E8 for the `HistoryRow` schema) first. Your goal: add `AdminConfig`, `AdminConfigUpdate`, `HistoryRow`, `HistoryResponse`, and `AdminErrorCodes` to `shared/src/wire.ts`. Touch only the listed entrypoints. Follow the TDD instructions. Do not modify any consumer of these types — that's other tasks. If `plans/eval-harness.md` is not yet checked in, use the schema fields listed in this plan's Task A3 outputs as the source of truth. Report: files changed, tests added, tests passing, anything outside scope.

### Task A4 — Frontend router with placeholder Admin page
- **Goal**: Install `react-router-dom`, wrap `<App />` in `<BrowserRouter>`, route `/` to `<PublicSearch />` and `/admin` to a placeholder `<Admin />` page that just renders `<h1>Admin</h1>`. Real Admin content lands in A8.
- **Entrypoints**:
  - `frontend/package.json` (modify — add `react-router-dom`)
  - `frontend/src/App.tsx` (modify)
  - `frontend/src/App.test.tsx` (modify)
  - `frontend/src/pages/Admin.tsx` (new — placeholder)
- **Inputs**: Existing App composition.
- **Outputs**:
  - `App.tsx` mounts `<BrowserRouter>` with two `<Route>` entries.
  - Placeholder `Admin.tsx` exports `Admin` and renders `<h1>Admin</h1>`. Will be replaced by A8.
  - Existing `<ApiKeyProvider>` continues to wrap both routes (the public search consumes it; admin doesn't but the wrapping is harmless).
- **TDD instructions**:
  1. Extend `App.test.tsx`. Use `MemoryRouter` instead of `BrowserRouter` for tests by extracting an inner `AppRoutes` component:
     - rendering at `/` shows the PublicSearch heading text
     - rendering at `/admin` shows the placeholder admin heading
     - rendering at `/garbage` falls back to PublicSearch (or to a 404 component — pick one and assert it; recommend: redirect to `/`)
  2. Confirm fail.
  3. Implement. Add `react-router-dom` and `@types/react-router-dom` to `frontend/package.json` and run `npm install`.
- **Subagent prompt**:
  > You are implementing Task A4 of plan `admin-ui`. Read `AGENTS.md` and `plans/admin-ui.md` first. Your goal: install `react-router-dom`, restructure `App.tsx` to use a `<BrowserRouter>` with `/` → `<PublicSearch />` and `/admin` → a placeholder `<Admin />` page. Touch only the listed entrypoints. Follow the TDD instructions. Do not implement the real admin UI — that's Task A8, your `Admin.tsx` is a one-line placeholder. Report: files changed, tests added, tests passing, anything outside scope.

### Task A5 — Pipeline plumbs visionPrompt to provider
- **Goal**: The OpenAI provider uses `config.visionPrompt` as its system prompt instead of the hardcoded literal. The hardcoded literal in `openai.ts` is removed in favor of the constant exported by `config/store.ts` (Task A1).
- **Entrypoints**:
  - `backend/src/providers/types.ts` (modify — add `systemPrompt: string` required field to `ExtractFromImageInput`)
  - `backend/src/providers/openai.ts` (modify — use `input.systemPrompt`; remove `SYSTEM_PROMPT` literal)
  - `backend/src/providers/openai.test.ts` (modify)
  - `backend/src/pipeline/visionExtract.ts` (modify — accept `visionPrompt` in deps, pass as `systemPrompt`)
  - `backend/src/pipeline/visionExtract.test.ts` (modify)
  - `backend/src/pipeline/run.ts` (modify — read `config.visionPrompt`, pass to visionExtract deps)
  - `backend/src/pipeline/run.test.ts` (modify)
- **Inputs**: A1's `Config.visionPrompt` and `DEFAULT_VISION_PROMPT` constant.
- **Outputs**:
  - `ExtractFromImageInput.systemPrompt: string` (required).
  - `openai.ts` uses `input.systemPrompt` verbatim as the system message; no fallback default in the adapter (the pipeline must always supply it).
  - `visionExtract` deps gain `visionPrompt: string`; threaded into the provider call.
  - `runPipeline` reads `config.visionPrompt` and passes it through.
  - The original `SYSTEM_PROMPT` constant in `openai.ts` is removed (its content lives in `config/store.ts` as `DEFAULT_VISION_PROMPT`).
- **TDD instructions**:
  1. Extend `openai.test.ts`: with a mocked SDK, assert the `messages[0].content` (system role) equals the `systemPrompt` passed in; calling without `systemPrompt` is a TS compile error (covered by required type).
  2. Extend `visionExtract.test.ts`: mock provider, assert `extractFromImage` was called with `systemPrompt: "fixture-prompt"` when deps `{ visionPrompt: "fixture-prompt" }`.
  3. Extend `run.test.ts`: with `getConfig` returning `{ ..., visionPrompt: "fixture" }`, assert provider received `systemPrompt: "fixture"`.
  4. Confirm fail.
  5. Implement. Remove `SYSTEM_PROMPT` literal from `openai.ts`.
- **Subagent prompt**:
  > You are implementing Task A5 of plan `admin-ui`. Read `AGENTS.md`, `plans/admin-ui.md`, and the diffs from Tasks A1 and A9 (both already merged) first. Your goal: thread `visionPrompt` from `Config` through the pipeline into the OpenAI provider's system message, replacing the hardcoded `SYSTEM_PROMPT` literal in `openai.ts`. Add `systemPrompt: string` (required) to `ExtractFromImageInput`. Note that A9 has already added `rerankWithImage` and a separate `RerankWithImageInput` to `providers/types.ts` and `openai.ts` — leave those alone, your changes only touch `ExtractFromImageInput` and `extractFromImage`'s system-message wiring. Touch only the listed entrypoints. Follow the TDD instructions. Do not modify the admin routes, frontend, or `Config` itself — A1 already added the field. Report: files changed, tests added, tests passing, anything outside scope.

### Task A6 — Admin backend routes (config CRUD + history)
- **Goal**: Mount `GET /admin/config`, `POST /admin/config`, `POST /admin/config/reset`, and `GET /admin/history` behind `requireAdminPassword`. History endpoint reads `backend/eval/history.jsonl`, parses line-by-line, returns up to 100 newest-first.
- **Entrypoints**:
  - `backend/src/api/admin/routes.ts` (new)
  - `backend/src/api/admin/routes.test.ts` (new)
  - `backend/src/app.ts` (modify — call `registerAdminRoutes(app)`)
- **Inputs**: A1 (config store + `validateConfig` + `resetConfig`), A2 (`requireAdminPassword`), A3 (wire types).
- **Outputs**:
  - `registerAdminRoutes(app: Express, deps?: { historyPath?: string }): void` — `historyPath` is injectable for tests; defaults to `path.resolve(process.cwd(), "eval/history.jsonl")`.
  - `GET /admin/config` → `200 AdminConfig` (the live config).
  - `POST /admin/config` body `AdminConfigUpdate` → validate via `validateConfig`; on `ok: true` call `setConfig`; respond `200` with the updated full `AdminConfig`. On `ok: false` respond `400 { code: "ADMIN_CONFIG_INVALID", message: "<joined errors>" }`.
  - `POST /admin/config/reset` → calls `resetConfig`; responds `200` with the (now-default) `AdminConfig`.
  - `GET /admin/history` → reads file; parses each line as JSON, drops malformed lines (count them, surface in a header `x-history-skipped`); returns `200 { rows: HistoryRow[] }` newest-first (reverse the array since the file is append-only-by-time), capped at last 100 (after reversing). If file is missing → `200 { rows: [] }`. If file is unreadable for other reasons → `503 { code: "ADMIN_HISTORY_UNAVAILABLE", message }`.
  - All four routes guarded by `requireAdminPassword` middleware applied at registration.
- **TDD instructions**:
  1. Write `routes.test.ts` using `supertest` against `createApp()`. Use `setConfigFilePath` (from A1) to point to a tmp file before each test; pass a tmp `historyPath` to `registerAdminRoutes`.
     - all four routes → `401` without `x-admin-password`
     - `GET /admin/config` returns the current config; `visionPrompt` is present
     - `POST /admin/config` with `{ topK: 5 }` returns merged config with `topK: 5`; second `GET` confirms persistence; tmp config.json now exists on disk
     - `POST /admin/config` with `{ topK: -1 }` returns `400 ADMIN_CONFIG_INVALID`
     - `POST /admin/config` with `{ unknownKey: 1 }` returns `400`
     - `POST /admin/config/reset` removes the tmp config.json and `GET` returns defaults
     - `GET /admin/history` with no file → `{ rows: [] }`
     - `GET /admin/history` with a tmp file containing 3 valid lines + 1 malformed line returns 3 rows, newest-first, response header `x-history-skipped: 1`
     - `GET /admin/history` caps at 100 when file has 150 lines, returns the 100 newest
  2. Confirm fail.
  3. Implement. Use `fs.promises.readFile` + `split("\n")` for history parsing — file is small. Skip empty lines silently; skip malformed JSON lines and increment a skipped counter for the response header.
  4. Wire into `app.ts`: import `registerAdminRoutes` and call it after `registerSearchRoute`.
  5. Re-read diff: confirm no admin password ever appears in any 4xx/5xx response body or log line; confirm `validateConfig` errors are joined into a user-readable string (no JSON stringify of internal stack).
- **Subagent prompt**:
  > You are implementing Task A6 of plan `admin-ui`. Read `AGENTS.md` and `plans/admin-ui.md` first. Your goal: ship `backend/src/api/admin/routes.ts` exporting `registerAdminRoutes(app, deps?)` that mounts `GET /admin/config`, `POST /admin/config`, `POST /admin/config/reset`, `GET /admin/history` behind the `requireAdminPassword` middleware (Task A2, already merged). Wire it into `backend/src/app.ts`. Touch only the listed entrypoints. Follow the TDD instructions. Use `setConfigFilePath` from `config/store.ts` to make tests hermetic. Do not modify the auth middleware, the config store, or the wire types — those are other tasks already merged. Report: files changed, tests added, tests passing, anything outside scope.

### Task A7 — Frontend admin client + auth state + login form
- **Goal**: A typed admin API client that sends `x-admin-password`, a `useAdminAuth` hook backed by `sessionStorage`, and an `<AdminLogin />` component that probes the password against `GET /admin/config`. On success, stores the password in session storage and renders children. On failure, surfaces an error.
- **Entrypoints**:
  - `frontend/src/lib/api/adminClient.ts` (new)
  - `frontend/src/lib/api/adminClient.test.ts` (new)
  - `frontend/src/lib/state/adminAuth.tsx` (new)
  - `frontend/src/lib/state/adminAuth.test.tsx` (new)
  - `frontend/src/components/AdminLogin.tsx` (new)
  - `frontend/src/components/AdminLogin.test.tsx` (new)
- **Inputs**: A3 wire types; A4's router scaffolding (Admin page is the consumer).
- **Outputs**:
  - `adminClient.ts` exports:
    - `getAdminConfig(password): Promise<AdminConfig>`
    - `updateAdminConfig(password, patch): Promise<AdminConfig>`
    - `resetAdminConfig(password): Promise<AdminConfig>`
    - `getAdminHistory(password): Promise<HistoryResponse>`
    - `class AdminClientError extends Error { code: string; status: number }` — thrown on non-2xx; `code` parsed from `ApiError` body.
  - `adminAuth.tsx` exports:
    - `<AdminAuthProvider>` — wraps children, stores `password: string | null` in sessionStorage under key `adminPassword`.
    - `useAdminAuth(): { password: string | null; setPassword: (p: string | null) => void; logout: () => void }`.
  - `AdminLogin.tsx` exports `<AdminLogin onAuthed={() => void}>`. Internally:
    - password input + submit button
    - on submit: call `getAdminConfig(password)`; if ok, `setPassword(password)` + `onAuthed()`; if `AdminClientError.code === "ADMIN_AUTH_INVALID"`, show "Incorrect password"; on other errors, show generic.
- **TDD instructions**:
  1. `adminClient.test.ts` (mock `fetch`):
     - `getAdminConfig` sends `GET /admin/config` with `x-admin-password` header
     - `updateAdminConfig` sends `POST /admin/config` with JSON body and the header
     - `resetAdminConfig` sends `POST /admin/config/reset` with the header
     - `getAdminHistory` sends `GET /admin/history` with the header
     - non-2xx with body `{ code, message }` throws `AdminClientError` carrying both
     - non-2xx with non-JSON body throws `AdminClientError` with `code: "UNKNOWN"`
  2. `adminAuth.test.tsx` (React Testing Library):
     - provider hydrates from sessionStorage on mount
     - `setPassword("foo")` writes to sessionStorage
     - `logout()` clears it
  3. `AdminLogin.test.tsx`:
     - submitting correct password (mocked `getAdminConfig` resolves) calls `onAuthed`
     - submitting wrong password (mock rejects with `AdminClientError("ADMIN_AUTH_INVALID")`) renders the error
     - the password field is `type="password"` (so it doesn't render in plaintext)
  4. Confirm fail.
  5. Implement. Reuse `VITE_API_URL` + `searchClient.ts` style for the base URL.
- **Subagent prompt**:
  > You are implementing Task A7 of plan `admin-ui`. Read `AGENTS.md` and `plans/admin-ui.md` first. Your goal: ship the admin API client (`frontend/src/lib/api/adminClient.ts`), the `useAdminAuth` sessionStorage hook (`frontend/src/lib/state/adminAuth.tsx`), and a login form component (`frontend/src/components/AdminLogin.tsx`). Touch only the listed entrypoints. Follow the TDD instructions. Do not assemble these into the Admin page — that's Task A8. Do not store the password in `localStorage`; use `sessionStorage` only. Report: files changed, tests added, tests passing, anything outside scope.

### Task A8 — Admin page: config form + history table
- **Goal**: Replace the placeholder `<Admin />` from A4 with a real page: gated by `<AdminLogin />`; once authed, shows two sections — a config form (fields for all knobs; Save + Reset buttons) and a history table (timestamp, gitSha[0..7], goldSetVersion, recall@5, MRR, p95 latency ms, total $).
- **Entrypoints**:
  - `frontend/src/pages/Admin.tsx` (modify — replaces A4 placeholder)
  - `frontend/src/pages/Admin.test.tsx` (new)
  - `frontend/src/components/AdminConfigForm.tsx` (new)
  - `frontend/src/components/AdminConfigForm.test.tsx` (new)
  - `frontend/src/components/AdminHistoryTable.tsx` (new)
  - `frontend/src/components/AdminHistoryTable.test.tsx` (new)
  - `README.md` (modify — short "Admin UI" subsection)
- **Inputs**: A3 wire types; A6 backend routes (consumed via A7's client); A7 auth state + login.
- **Outputs**:
  - `AdminConfigForm`:
    - props: `{ initial: AdminConfig; password: string; onSaved?: (next: AdminConfig) => void }`
    - controlled fields:
      - number input (`topK`)
      - checkbox (`rerank`)
      - text input (`visionModel`)
      - textarea (`visionPrompt`)
      - text input (`rerankModel`)
      - textarea (`rerankPrompt`)
      - number input (`rerankTopN`)
    - Layout grouped into two `<fieldset>`s — "Search" (topK, visionModel, visionPrompt) and "Rerank" (rerank, rerankModel, rerankPrompt, rerankTopN). The rerank-section inputs other than the toggle are disabled when `rerank` is unchecked, but values are preserved (sent on next save).
    - Save button: calls `updateAdminConfig(password, dirtyFields)`. Shows inline success / error.
    - Reset button: confirm dialog (`window.confirm`) → `resetAdminConfig(password)` → re-populate fields with response.
    - Disable Save while in flight; surface `AdminClientError.message` on failure.
  - `AdminHistoryTable`:
    - props: `{ rows: HistoryRow[] }`
    - renders a `<table>` with the columns above. Empty state: "No eval runs yet — run `npm run eval` from `backend/` to populate history."
    - timestamps formatted as `toLocaleString()`.
  - `Admin.tsx`:
    - if `useAdminAuth().password` is null → render `<AdminLogin onAuthed={() => {}} />`
    - else: fetch config + history on mount; show `<AdminConfigForm>` and `<AdminHistoryTable>`; show a small "Logout" button that calls `logout()`.
    - On 401 from any call (e.g. password rotated server-side mid-session) → call `logout()` and re-render the login form.
  - README "## Admin UI" subsection (≤ 12 lines): URL `/admin`, env `ADMIN_PASSWORD` (default `admin`), what each knob does, location of `data/config.json`, where history comes from.
- **TDD instructions**:
  1. `AdminConfigForm.test.tsx`:
     - renders all seven fields populated from `initial`
     - editing `topK` to `5` and clicking Save calls `updateAdminConfig(password, { topK: 5 })` (only the changed key)
     - editing `rerankTopN` to `8` and clicking Save calls `updateAdminConfig(password, { rerankTopN: 8 })`
     - unchecking `rerank` disables the rerankModel / rerankPrompt / rerankTopN inputs; preserved values are still sent on next save
     - on save success, calls `onSaved` with the response
     - on save error (`AdminClientError`), shows the error message
     - Reset button after `window.confirm` returning true calls `resetAdminConfig`
     - Save is disabled while a save is in flight
  2. `AdminHistoryTable.test.tsx`:
     - renders one row per `HistoryRow`
     - empty array → empty-state message containing "No eval runs"
     - gitSha column shows only first 7 characters
     - cost column formatted with `$` prefix
  3. `Admin.test.tsx`:
     - with no password in session → renders the login form
     - with a valid password (mocked `getAdminConfig` + `getAdminHistory` resolve) → renders both sections after fetch
     - clicking Logout clears session and re-renders login
     - if a fetch returns 401 (mocked `AdminClientError("ADMIN_AUTH_INVALID")`), state is logged out and login is rendered
  4. Confirm fail.
  5. Implement. Plain HTML + minimal CSS (extend existing `index.css`). No new component libraries.
  6. Add the README subsection.
- **Subagent prompt**:
  > You are implementing Task A8 of plan `admin-ui`. Read `AGENTS.md` and `plans/admin-ui.md` first. Your goal: replace the placeholder `frontend/src/pages/Admin.tsx` (from Task A4) with a real Admin page composed of `<AdminLogin>` (Task A7), a new `<AdminConfigForm>`, and a new `<AdminHistoryTable>`. Wire it to the admin client (Task A7) and consume Task A3's wire types. Add a short "## Admin UI" subsection to README. Touch only the listed entrypoints. Follow the TDD instructions. Do not modify the admin client, auth state, or login form — those are A7. Do not modify backend code. Report: files changed, tests added, tests passing, anything outside scope.

### Task A9 — Provider `rerankWithImage` + OpenAI adapter
- **Goal**: Add a new method on the `Provider` interface — `rerankWithImage` — and implement it for OpenAI. Image-attached, structured-JSON response, returns ordered ids + token usage. No pipeline changes here.
- **Entrypoints**:
  - `backend/src/providers/types.ts` (modify — add `RerankWithImageInput`, `RerankWithImageResult`, `Provider.rerankWithImage` method; also continue carrying A5's `systemPrompt` change)
  - `backend/src/providers/openai.ts` (modify — implement `rerankWithImage`)
  - `backend/src/providers/openai.test.ts` (modify — add cases)
- **Inputs**: Existing `Provider` interface; awareness of A1's `rerankPrompt`/`rerankModel` knobs (consumed via the `systemPrompt` and `model` input fields, not imported directly).
- **Outputs**:
  - `RerankWithImageInput`:
    ```ts
    {
      apiKey: string;
      model: string;
      systemPrompt: string;
      image: Buffer;
      mimeType: string;
      candidates: Array<{ id: string; title: string; description: string }>;
    }
    ```
  - `RerankWithImageResult`:
    ```ts
    {
      orderedIds: string[];
      usage: ProviderUsage;
    }
    ```
  - `Provider.rerankWithImage(input: RerankWithImageInput): Promise<RerankWithImageResult>`. Method is required on the interface (the OpenAI adapter ships it; the pipeline gates calls behind `config.rerank`).
  - OpenAI adapter implementation:
    - Builds a single user message with the image (data URL) + a JSON-stringified candidates list (id, title, description).
    - Uses `response_format: { type: "json_schema", json_schema }` with schema `{ orderedIds: string[] }`.
    - Pulls `usage.prompt_tokens` / `usage.completion_tokens` exactly like `extractFromImage` does.
    - On any SDK throw → `ProviderError({ code: "PROVIDER_HTTP_ERROR", message: "The model provider rejected the request." })` (no upstream message, no key leak).
    - On empty / non-string content → `ProviderError("INVALID_RESPONSE", "The model returned an empty response.")`.
    - On parse failure → `ProviderError("INVALID_RESPONSE", "The model response was not valid JSON.")`.
    - The adapter does **not** validate the orderedIds set against the candidates — that's the pipeline's defensive concern (Task A10).
- **TDD instructions**:
  1. Extend `openai.test.ts`:
     - `rerankWithImage` with mocked SDK returning `{ orderedIds: ["b","a"] }` returns `{ orderedIds: ["b","a"], usage: { promptTokens, completionTokens, model } }`
     - SDK throw → `ProviderError("PROVIDER_HTTP_ERROR")`
     - empty content → `ProviderError("INVALID_RESPONSE", "...empty...")`
     - non-JSON content → `ProviderError("INVALID_RESPONSE", "...not valid JSON...")`
     - The mocked SDK call's `messages[0].content` is the `systemPrompt` passed in
     - The user message includes the image as a data URL with the supplied mimeType
     - Adapter does **not** filter or validate orderedIds — even if returned ids are missing or extra, the result is returned verbatim (test asserts this; pipeline tests assert the defensive behavior)
  2. Confirm fail.
  3. Implement.
- **Subagent prompt**:
  > You are implementing Task A9 of plan `admin-ui`. Read `AGENTS.md` and `plans/admin-ui.md` first. Your goal: add `rerankWithImage` to the `Provider` interface in `backend/src/providers/types.ts` and implement it in `backend/src/providers/openai.ts`. Touch only the listed entrypoints. Follow the TDD instructions. Do not touch the pipeline, config, or admin code — those are other tasks. The adapter returns whatever ids the model produces verbatim; defensive validation lives in the pipeline (Task A10). Report: files changed, tests added, tests passing, anything outside scope.

### Task A10 — Pipeline: rerank stage uses provider, threads image
- **Goal**: Replace the `rerank.ts` stub with a real implementation that calls `provider.rerankWithImage` over the top-N catalog candidates and reorders them. Defensive: on id mismatch, fall back to the input order. Aggregates rerank token usage into the existing `meta.tokens` / `meta.costUsd`.
- **Entrypoints**:
  - `backend/src/pipeline/rerank.ts` (modify)
  - `backend/src/pipeline/rerank.test.ts` (modify)
  - `backend/src/pipeline/run.ts` (modify — thread image + rerank knobs through; aggregate rerank usage)
  - `backend/src/pipeline/run.test.ts` (modify)
- **Inputs**: A1's `rerankModel`/`rerankPrompt`/`rerankTopN` knobs; A9's `provider.rerankWithImage`; A5's `Config.visionPrompt` and pipeline plumbing for it (already merged when this task runs).
- **Outputs**:
  - `rerank.ts` exports:
    ```ts
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
      products: Product[];
      usage?: ProviderUsage; // only when rerank actually ran
    }
    export async function rerank(
      results: Product[],
      attributes: ExtractedAttributes,
      deps: RerankDeps,
    ): Promise<RerankResult>;
    ```
  - When `enabled === false`: returns `{ products: results }` with no provider call, no usage.
  - When enabled but `results.length <= 1`: returns `{ products: results }` with no provider call (nothing to reorder).
  - When enabled with `results.length >= 2`:
    - slice `head = results.slice(0, deps.topN)`, `tail = results.slice(deps.topN)`
    - call `provider.rerankWithImage` with `candidates = head.map(p => ({ id: p._id, title: p.title, description: p.description }))`
    - validate `orderedIds`: must be a permutation of the `head` ids — same length, same set, no extras, no dupes. If invalid → return `{ products: results, usage }` (preserve original order, but still report cost).
    - on success → reorder `head` by `orderedIds`, concatenate `tail` unchanged, return `{ products: [...reorderedHead, ...tail], usage }`.
  - `runPipeline`:
    - reads `config.rerank`, `config.rerankModel`, `config.rerankPrompt`, `config.rerankTopN`
    - threads `input.image`, `input.mimeType`, `input.apiKey` into rerank deps
    - if rerank ran: pushes the returned `usage` into the same `usages` array that vision contributes to, so the existing `sumTokens` / `sumCost` aggregation picks it up automatically
    - `meta.stagesRan` semantics unchanged: `"rerank"` appears iff the stage ran (i.e. `config.rerank === true`, even if it short-circuited on `length <= 1`)
- **TDD instructions**:
  1. Extend `rerank.test.ts`:
     - `enabled: false` → returns `{ products: input }`, provider not called
     - enabled with 1 product → returns input unchanged, provider not called
     - enabled with 3 products and provider returning `orderedIds: ["c","a","b"]` → products reordered to `[c, a, b]`; returned `usage` matches mock
     - `topN = 2` with 5 inputs → only first 2 are reordered; tail of 3 preserved in original order
     - provider returns mismatched orderedIds (extra id, missing id, dupes) → falls back to original order; usage still returned
     - provider throws → error propagates (the api layer scrubs it)
  2. Extend `run.test.ts`:
     - with `getConfig` returning `{ rerank: true, rerankModel: "X", rerankPrompt: "Y", rerankTopN: 2, ... }` and a mocked `provider.rerankWithImage` returning known orderedIds + usage `{ promptTokens: 30, completionTokens: 10, model: "X" }`:
       - `meta.tokens.total` includes both vision tokens and rerank tokens
       - `meta.costUsd` includes the rerank model's contribution
       - `meta.stagesRan` includes `"rerank"`
       - the order of `results` reflects the rerank
       - `meta.topResults` (top-3 raw, pre-rerank) is unchanged from the catalog stage
     - with `getConfig` returning `{ rerank: false, ... }`: provider's rerankWithImage is **not** called; `meta.stagesRan` does not include `"rerank"`
  3. Confirm fail.
  4. Implement.
  5. Re-read diff: confirm rerank result type doesn't leak the api key or system prompt out of the deps; confirm tail products are preserved verbatim.
- **Subagent prompt**:
  > You are implementing Task A10 of plan `admin-ui`. Read `AGENTS.md` and `plans/admin-ui.md` first. Your goal: replace the rerank stub with a real implementation that calls `provider.rerankWithImage` (Task A9, already merged) over the top-N catalog candidates, defensively validates the returned ids are a permutation of the inputs, and falls back to the input order on mismatch. Thread the image, api key, rerank model/prompt/topN from `runPipeline` into the stage; aggregate rerank token usage into the existing `meta.tokens`/`meta.costUsd` sums. Touch only the listed entrypoints. Follow the TDD instructions. Do not touch providers, config, or admin code — those are other tasks already merged. Report: files changed, tests added, tests passing, anything outside scope.

## Dependency graph

```
A1 (config store + visionPrompt + rerank knobs) ──┬──► A5 (pipeline plumbs visionPrompt)
                                                   ├──► A6 (admin routes) ──────────────────┐
                                                   └──► A10 (rerank stage)                  │
A2 (admin auth middleware) ───────────────────────────► A6                                   │
A3 (wire types) ──────────────────────────────────┬──► A6                                   │
                                                   │                                          ▼
                                                   └──► A7 (admin client + auth + login) ──► A8 (admin page)
                                                                                              ▲
A4 (router + placeholder) ──────────────────────────────────────────────────────────────────┘
A9 (provider.rerankWithImage) ──────────────────────► A10
A5 (visionPrompt plumbing) ─────────────────────────► A10  (both touch run.ts; A10 reads A5's merged version)
```

## Parallel execution strategy

- **Wave 1** (parallel — 5 tasks, fully independent):
  - **A1** — config store changes (backend/src/config/, backend/.gitignore)
  - **A2** — admin auth middleware (backend/src/api/admin/auth.ts)
  - **A3** — wire types (shared/src/wire.ts)
  - **A4** — frontend router + placeholder (frontend/src/App.tsx, frontend/src/pages/Admin.tsx, frontend/package.json)
  - **A9** — provider `rerankWithImage` (backend/src/providers/{types,openai}.ts) — only depends on the existing `Provider` shape
- **Wave 2** (parallel — 3 tasks):
  - **A5** — pipeline plumbs `visionPrompt` (depends on A1) — modifies `run.ts`
  - **A6** — admin backend routes (depends on A1, A2, A3) — adds `registerAdminRoutes` call to `app.ts`
  - **A7** — frontend admin client + auth state + login (depends on A3)
- **Wave 3** (parallel — 2 tasks):
  - **A10** — rerank stage uses provider (depends on A1, A5, A9) — also modifies `run.ts`, sequenced after A5 to avoid the conflict
  - **A8** — admin page assembly (depends on A3, A4, A6, A7) — replaces the A4 placeholder

Conflict notes:
- A1 and A5 both touch `Config`-adjacent code but in disjoint files (A1: `config/store.ts`; A5: `providers/*`, `pipeline/*`). Sequencing keeps A5 reading the merged A1 contract.
- A5 and A10 both modify `pipeline/run.ts` and `pipeline/run.test.ts`. Sequencing across waves (A5 in Wave 2, A10 in Wave 3) avoids the conflict.
- A9 and A5 both modify `providers/types.ts` and `providers/openai.ts` (and their test files). **Conflict** — both are in different waves originally. **Resolution**: A9 moves to Wave 2 if A5's edits land first, OR A9 stays in Wave 1 and A5 rebases on top. **Chosen**: keep A9 in Wave 1; A5's diff is small and additive (one new field on `ExtractFromImageInput`, one prompt edit), so A9 ships first and A5 in Wave 2 just adds to A9's already-merged file. Subagent prompts reflect this — A5's prompt is amended below.
- A6 modifies `app.ts`; no other task in any wave touches `app.ts`, so this is conflict-free.
- A8 modifies `Admin.tsx` (touched by A4). A4 → A8 is sequenced across waves, no parallel conflict.

## Verification

`/execute` confirms completion by checking:

1. **Files exist** at every entrypoint listed (including the placeholder `data/config.json` is *not* checked in — `backend/.gitignore` blocks it).
2. **Type-check clean**: `tsc --noEmit` passes in `backend/`, `frontend/`, `shared/`.
3. **All unit tests green**:
   - `backend/`: `npm test` — config store (file-backed cases), admin auth middleware, admin routes (all four endpoints + 401 paths), updated provider/visionExtract/run tests.
   - `frontend/`: `npm test` — App routing, AdminLogin, AdminConfigForm, AdminHistoryTable, Admin page (auth-gated assembly), adminClient, useAdminAuth.
   - `shared/`: `vitest` — extended wire types compile and the negative `// @ts-expect-error` cases hold.
4. **Pipeline still uses Config**: grep `getConfig()` in `backend/src/pipeline/run.ts` still present; `SYSTEM_PROMPT` literal in `backend/src/providers/openai.ts` is removed.
5. **Auth gating**: hitting `GET /admin/config` without `x-admin-password` returns `401`; with the wrong header returns `401`; with `admin` (or whatever the env says) returns `200`.
6. **File persistence works end-to-end**: `POST /admin/config` with `{ topK: 5 }` writes `backend/data/config.json` with `topK: 5`; restarting the process and `GET /admin/config` returns `topK: 5`.
7. **Reset works**: `POST /admin/config/reset` deletes `backend/data/config.json` and `GET` returns defaults.
8. **History endpoint resilience**: with no `backend/eval/history.jsonl` file, `GET /admin/history` returns `{ rows: [] }` without crashing.
9. **Routing**: visiting `http://localhost:5173/admin` in the dev server renders the login form; entering `admin` shows the config form and history table; `localhost:5173/` still shows the public search.
10. **Secrets hygiene**: grep `backend/src/api/admin` for `ADMIN_PASSWORD` shows reads via `process.env` only; never logged, never echoed in 4xx/5xx response bodies. Frontend uses `sessionStorage` (not `localStorage`).
11. **README** has an "## Admin UI" subsection covering route, env var, default password, config-file location, and a note that rerank is on by default with the cost implication.
12. **Gitignore**: `backend/.gitignore` contains `data/`. `git status` after `setConfig` does not show `backend/data/config.json` as untracked.
13. **Rerank wired end-to-end**: with default config (`rerank: true`), a search invocation calls `provider.rerankWithImage` exactly once; `meta.stagesRan` includes `"rerank"`; `meta.tokens.total` and `meta.costUsd` reflect both vision and rerank usage; `meta.topResults` (top-3 raw, pre-rerank) is unchanged from the catalog stage. Toggling `rerank: false` via `POST /admin/config` and hitting `/search` again produces a response with `meta.stagesRan` not containing `"rerank"` and zero rerank tokens.
14. **Rerank defensive fallback**: pipeline test confirms that when the provider returns mismatched ids, `results` are returned in their original (catalog) order rather than crashing.
15. **Rerank reorder-only invariant**: pipeline test confirms `output.results.length === input.results.length` (no truncation) and the id set of `head` is preserved across the rerank.
