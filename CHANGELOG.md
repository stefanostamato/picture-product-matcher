# CHANGELOG

Each entry captures the *why* behind a change, the architectural choices
made, and the prompts/agents that drove the work. The focus is the search
functionality and how it gets implemented — see `plans/` for the
right-sized task plans this changelog references, and `NOTES.md` for the
play-by-play and original prompts.

## Unreleased

The thinnest working slice of the picture-product-matcher: real photo
in, real catalog matches out. Pipeline-shaped backend + single React
page + env-guarded e2e smoke. Plan: [`plans/initial-e2e.md`](plans/initial-e2e.md).
Driven by `/plan` (architect-mode planning) and `/execute` (parallel-
wave subagent execution); see `NOTES.md` §2 for the originating prompts.

### chore(infra): scaffold workspace, docker compose, /health

**What changed:** Three-package layout (backend/frontend/shared) with
TS strict mode + Vitest in each. `docker compose up` brings the dev
stack up with hot-reload bind mounts. Backend exposes `GET /health`
to prove boot.

**Why:** Establishes the package boundaries before any feature lands —
shared wire types must have one home, the catalog DB client must be
isolated from pipeline code (AGENTS.md §5), and the dev loop has to be
one command.

### feat(catalog): mongo discovery, schema doc, Product type

**What changed:** `scripts/explore-db.mjs` samples the read-only Atlas
catalog and dumps indexes + field-type table + categorical
cardinalities. Output drives the canonical `Product` type and the
`PRODUCT_CATEGORIES` enum in `shared/src/catalog.ts`, plus a schema
reference at `docs/catalog-schema.md`.

**Why:** The catalog is read-only and not under our control. The
search pipeline needs the real schema (15 categories, weighted text
index on title+description, compound index on category+type+price) —
not guesses — to build a filter that returns matches instead of
zeroing them out.

**Agent prompts used:** *"Please explore the db and tell me what you
find — fields, indexes, anything we can use to solve this challenge."*

### feat(shared): wire-format types

**What changed:** `ExtractedAttributes`, `SearchRequest`,
`SearchResponse` (with per-stage `latencyMs` / `stagesRan` and a
`lowConfidence` flag for the empty-result case), and `ApiError`.
Frontend and backend import the same shapes via the `shared/*` path
alias.

**Why:** One definition for the HTTP boundary keeps the two sides in
lockstep without backwards-compat drift. `lowConfidence` is in the
wire format from day one because the user-facing UX needs to render
the no-good-matches case differently from a hard error.

### feat(backend): provider, catalog, config, metrics modules

**What changed:** `Provider` interface + OpenAI vision adapter using
structured-output JSON schema (`category` constrained to
`PRODUCT_CATEGORIES`); `searchCatalog` module that is the only place
in the backend importing `mongodb`; in-memory `config/store` for
tunable knobs (`topK: 20`, `rerank: false`, model names); per-request
metrics collector for stage latency.

**Why:** These are the *seams* the rest of the project hangs off.
Provider abstraction lets a second adapter land as one new file. One
catalog module means future caching/index strategies have one home.
Config + metrics exist now so the eval harness and admin UI plug in
without a retrofit (AGENTS.md §6/§8). Constraining the model's
`category` to the canonical enum is the difference between getting
matches and silently zeroing the result set on a stray "sofa" vs
"Sofas" mismatch.

### feat(backend): search pipeline orchestrator

**What changed:** Five typed stages — `visionExtract`, `queryBuild`,
`catalogSearch`, `rerank` (passthrough stub, off by default), `run`
— wired by `runPipeline(input, deps)`. `queryBuild` snaps the
extracted category to a canonical `PRODUCT_CATEGORIES` entry case-
insensitively and drops the filter on a non-match. Rerank's seam is
the config flag, not the behaviour.

**Why:** Pipeline-shaped, not framework-shaped (AGENTS.md §5).
Reordering, A/B-ing, or swapping a stage doesn't ripple into HTTP or
DB code. The category-snap + drop-on-miss is belt-and-suspenders
behind the schema-level enum constraint: even if the model slips a
bad value through, we degrade to a text-only search instead of
returning nothing.

### feat(api): POST /search with multipart, CORS, error mapping

**What changed:** Express handler using `multer` (memory storage, 8MB
cap, jpeg/png/webp filter); `x-api-key` header for the per-request
key; structured `ApiError` mapper that scrubs the API key from any
echoed message; CORS allowing the Vite origin so browser preflights
pass; key-scrubbed `console.error` for 5xx so silent server-side
failures stop being invisible.

**Why:** The API surface enforces every constraint AGENTS.md §8 lays
down: the key never persists, never logs, never appears in error
bodies. The error mapper is the single defence-in-depth point — even
if an internal layer carelessly embeds the key in a message, the
boundary scrubs it. The 5xx logging was added after a debugging round
where empty responses with no logs made root-causing impossible.

### feat(frontend): public search UI

**What changed:** Single React + Vite page — API-key input (password
type, React context, never `localStorage`/`sessionStorage`), image
drop, optional prompt, submit, results grid, error banner, low-
confidence banner. Typed `searchClient` builds the multipart body and
attaches `x-api-key` without setting `Content-Type` (so the browser
writes the multipart boundary).

**Why:** This is the surface that proves the slice end-to-end. The
key-handling rules from AGENTS.md §8 are enforced *here*, in the
component that holds the key — moving them downstream is too late.
Wire types come from `shared/`, so the UI and backend can't drift.

### test(backend): env-guarded e2e smoke + JPEG fixture

**What changed:** One supertest e2e hitting `createApp()` that runs
when `RUN_E2E=1` and `OPENAI_API_KEY` + `DB_URL` are set; skips
cleanly otherwise. Asserts `results.length > 0` and that
`meta.stagesRan` covers `visionExtract`/`queryBuild`/`catalogSearch`.
A 2.8 KB synthetic JPEG fixture lives at `backend/test/fixtures/`.

**Why:** Unit tests verify each stage in isolation; the e2e is the
proof that the wire flow *actually* lands a real photo in and a real
catalog row out. Env-guarding keeps it out of the default CI path so
nobody accidentally burns OpenAI credits on `npm test`.

### docs: README, NOTES, plans, CHANGELOG

**What changed:** README run-flow, env vars, troubleshooting (incl.
the named-volume gotcha when adding a backend dep). NOTES captures
the play-by-play. `plans/initial-e2e.md` and `plans/eval-harness.md`
land alongside the code so the right-sized task graphs and the
prompts that drove them are versioned with the work.

**Why:** AGENTS.md §10: "CHANGELOG.md reflects the *why*, not just
the *what*." The challenge brief asks for prompts/instructions
captured alongside the work — `plans/` and `NOTES.md` are where that
detail lives, and this entry is the index into them.

**Agent prompts used:**

- `/plan`: *"I want to build an initial end-to-end version of this
  project. Read NOTES.md for what we're trying to build. Can you tell
  me what you'd propose?"* → produced [`plans/initial-e2e.md`](plans/initial-e2e.md).
- `/execute`: dispatched the 6-wave subagent execution against that
  plan.
- Mid-flight debugging (CORS preflight, missing `DB_URL` in the
  container env, silent 500s, empty-result root-cause on the category
  mismatch) was driven by terse user reports of the failing UI/console
  output — every fix landed in code changes captured in the commits
  above.
- `/push-change`: produced this CHANGELOG entry and the commit
  structure landing the slice.
