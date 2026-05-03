# AGENTS.md

Operating manual for any AI agent (or human) contributing to this repo. Read this before writing code. If something here conflicts with NOTES.md, NOTES.md is the source of intent — this file is the source of *how we build*.

## 1. What we're building

A web app that turns an uploaded photo (a room, a piece of furniture, a vibe board) into ranked product matches against First Chair's catalog. Optional natural-language prompt narrows results. Users provide their own model-provider API key at runtime (in-memory only — never persisted, never logged).

Two user roles:
- **Public user** — uploads image, optionally adds prompt, gets ranked results.
- **Admin user** — views and tunes retrieval/ranking meta-parameters (top-K, rerank on/off, attribute weights, prompt templates, model choice). Public users cannot reach this surface.

Hard constraint: the catalog DB is **read-only**. Don't write to it, don't propose schema changes, don't introduce a parallel store unless it's explicitly justified.

## 2. Stack

- **Frontend**: React + TypeScript
- **Backend**: Node + TypeScript
- **DB**: MongoDB (read-only catalog, text index on `title`(2)+`description`(1), compound on `category`+`type`+`price`)
- **Models**: Vision + text LLMs via user-provided API key (provider abstraction must stay swappable)

## 3. Repository layout

```
backend/    Node + TS. API, pipeline, providers, catalog, config, eval.
frontend/   React + TS. Pages, components, api client, in-memory state.
shared/     Wire-format types imported by both backend and frontend. No runtime logic.
scripts/    One-off tooling (e.g. explore-db.mjs). Not shipped.
plans/      Feature plans produced by /plan, consumed by /execute.
```

Each of `backend/` and `frontend/` is its own package with its own `package.json`, `tsconfig.json`, and `Dockerfile`. `shared/` is a tiny package consumed by both.

## 4. Running locally

**Canonical**: `docker compose up` from the repo root. Brings up backend and frontend with hot-reload — host source is bind-mounted into each container, `node_modules` lives in a named volume so host/container architectures don't collide. `shared/` is mounted into both. No DB container — the catalog is a hosted Atlas cluster (read-only credentials in `scripts/explore-db.mjs`).

`docker-compose.yml` (canonical shape):

```yaml
services:
  backend:
    build: ./backend
    command: npm run dev
    volumes:
      - ./backend:/app
      - ./shared:/shared
      - backend_node_modules:/app/node_modules
    ports:
      - "3001:3001"
    environment:
      - NODE_ENV=development
      - PORT=3001

  frontend:
    build: ./frontend
    command: npm run dev -- --host
    volumes:
      - ./frontend:/app
      - ./shared:/shared
      - frontend_node_modules:/app/node_modules
    ports:
      - "5173:5173"
    environment:
      - NODE_ENV=development
      - VITE_API_URL=http://localhost:3001
    depends_on:
      - backend

volumes:
  backend_node_modules:
  frontend_node_modules:
```

**Alternative (fast inner-loop)**: `npm run dev` inside `backend/` and `frontend/` separately. Use this for tight iteration when Compose feels heavy.

User-provided LLM API keys are passed at request time from the frontend; they are never set as env vars on either service.

## 5. Architecture

Pipeline-shaped, not framework-shaped. Each stage is a pure-ish module with a typed input and output. Easy to reorder, swap, or A/B.

```
[image + optional prompt]
  → vision-extract     → { category, type, style, material, color, dimensions?, description, price-band? }
  → query-build        → text query + hard filters (refined by user prompt if present)
  → catalog-search     → top-N candidates from Mongo (text + filter)
  → rerank (optional)  → LLM rerank of top-N with image attached
  → response           → ranked results + per-result rationale
```

**Layering** (backend):
- `api/` — HTTP handlers, request validation, auth boundary. Thin.
- `pipeline/` — the stages above, each its own module. No HTTP, no DB clients leaking in.
- `providers/` — LLM provider adapters behind one interface. Swap without touching pipeline.
- `catalog/` — Mongo access. One module owns the queries; nobody else talks to Mongo.
- `config/` — admin-tunable parameters. In-memory store; single source of truth read by pipeline.
- `eval/` — test harness, fixtures, metrics. Runnable standalone.

**Layering** (frontend):
- `pages/` — route-level views (Public, Admin).
- `components/` — presentational, no fetching.
- `lib/api/` — typed client for the backend. One place that knows about HTTP.
- `lib/state/` — API-key state (memory only), config state for admin.

Cross-cutting: types shared between frontend and backend live in a `shared/` (or equivalent) module so the wire format has one definition.

## 6. Software development principles

These are non-negotiable. NOTES.md lists them; this expands what they mean for this repo.

1. **Keep it simple.** No DB unless the in-memory store genuinely cannot serve the use case. No queue, no cache, no microservice. If a function fits in 30 lines, don't make it a class. Three similar lines beat a premature abstraction.
2. **DRY, but only for real duplication.** Duplicated *intent* deserves a shared function. Duplicated *shape* (two things that happen to look alike today) does not — wait until the third occurrence.
3. **Separation of concerns.** API handlers don't run prompts. Pipeline stages don't open Mongo connections. Components don't fetch. If a file does two jobs, split it.
4. **Clear abstractions.** Every module exports a small, named, typed surface. The provider interface is the canonical example: one shape, multiple implementations, callers don't know which one runs.
5. **Designed to scale (in clarity, not infrastructure).** Scale here means: a new contributor can find where to add a new ranking strategy in under five minutes. New strategies plug into the pipeline; they don't fork it.

## 7. Code structure rules

- **Naming earns its keep.** A reader should learn what a thing does from its name. `rerankCandidates` over `process2`. No abbreviations the team doesn't already use.
- **Default to no comments.** Names and types do the talking. Add a comment only when the *why* is non-obvious — a constraint, a workaround, a subtle invariant. Never narrate the *what*.
- **Files stay small and topical.** If a file passes ~250 lines, ask whether it's doing two jobs.
- **Types at boundaries.** Every exported function has explicit input/output types. Internal helpers can infer.
- **No dead code, no `// TODO` graveyards, no commented-out blocks.** Delete it; git remembers.
- **Errors fail loudly at boundaries, gracefully at the edges.** Internal code throws. The API handler catches and returns a structured error the frontend can render.
- **No backwards-compat shims.** This is a fresh build. Rename freely; don't leave aliases.

## 8. Non-functional requirements

- **Secrets**: The user's API key lives in memory for the duration of the session only. Never log it, never write it to disk, never include it in error messages or analytics. Backend treats it as a per-request credential, not server config.
- **Admin isolation**: Public surface and admin surface are distinguishable at the route and API level. A public user cannot reach admin endpoints by guessing URLs.
- **Edge cases (stretch but expected)**: API-provider failure → user-facing error with a retry path. Unrecognizable image → graceful "we couldn't read this image" response. No good matches → return the best-effort set with a low-confidence signal, not an empty crash.
- **Observability**: For every search, capture (locally, in-memory or simple log): latency per stage, token counts, whether rerank ran. The eval harness depends on this.
- **Eval**: There must be a runnable, lightweight evaluation: a small fixture set of (image, expected match), measuring recall, an LLM-as-judge relevance score, latency, and cost per run. Eval is part of the deliverable, not an afterthought.
- **Performance budget (soft)**: A single search should feel interactive. If a stage routinely exceeds ~2s, it needs justification or an async-feedback UX.
- **Determinism where possible**: Pipeline stages should accept seeds / temperature 0 by default in eval mode so runs are comparable.

## 9. How agents should work in this repo

- **Plan before coding** for anything beyond a one-file change. Use `/plan`.
- **Execute in parallel waves** when tasks are independent. Use `/execute`.
- **Commit in logical groups** with motivation captured in CHANGELOG.md. Use `/push-change`.
- **TDD for pipeline stages.** Each stage gets a unit test with fixed inputs before the implementation lands. Pipeline correctness is the whole product.
- **No surprise scope.** A bug fix doesn't bring a refactor. A feature doesn't bring a rename. If you see something worth changing, note it and move on.
- **Verify, don't assert.** If you say "this works," you've run it. If you say "tests pass," you've seen them pass in this session.

## 10. What "done" looks like

A change is done when:
- It satisfies the spec it was scoped against.
- Tests covering its behavior pass locally.
- The relevant pipeline stage (if touched) still produces sane output on the eval fixtures.
- CHANGELOG.md reflects the *why*, not just the *what*.
- No unrelated files moved.
