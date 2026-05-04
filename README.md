# picture-product-matcher

A web app that turns an uploaded photo into ranked product matches against
First Chair's catalog. An optional natural-language prompt narrows results.
Users supply their own model-provider API key at runtime; it is held in
memory only.

## Run it locally

You need Docker, an OpenAI API key, and the read-only MongoDB Atlas URI for
the catalog.

1. **Set the catalog URI.** Copy the env template and fill in the connection
   string you were given:

   ```bash
   cp .env.example .env
   # then edit .env and set DB_URL=mongodb+srv://USER:PASSWORD@CLUSTER.mongodb.net/catalog?...
   ```

   `.env` is gitignored. `DB_NAME` and `COLLECTION_NAME` are optional
   overrides — the defaults (`catalog` / `products`) match the seeded data.
   The OpenAI key is **not** an env var: it is supplied per-request from the
   UI and forwarded as `x-api-key`, never persisted.

2. **Start the stack.**

   ```bash
   docker compose up
   ```

   - Frontend: http://localhost:5173
   - Backend:  http://localhost:3001

   First boot installs deps inside the containers (slower); subsequent
   boots are fast. Hot-reload is wired via host bind mounts.

3. **Run a search.** Open the frontend, paste your OpenAI key into the
   **API key** field, drop an image (JPEG / PNG / WebP, ≤ 8 MB), optionally
   add a prompt (e.g. "rustic, oak"), and submit.

## System overview

The product is a thin pipeline that takes a photo and returns ranked
catalog matches. Each stage is a small, typed module so we can reorder,
swap, or A/B without touching the orchestrator. Source of truth for the
shape is [backend/src/pipeline/run.ts](backend/src/pipeline/run.ts).

```
[image + optional prompt]
  → vision-extract   → { category, type, style, material, color, description, ... }
  → query-build      → text query + hard category filter
  → catalog-search   → top-K candidates from Mongo $text index
  → rerank (stub)    → behind admin flag, currently passthrough
  → response         → ranked products + diag metadata
```

### Retrieval and ranking

The catalog has no images and no embeddings — only structured text fields
plus a Mongo `$text` index weighted on `title`(2) + `description`(1). The
retrieval strategy is built around what the index actually exposes:

- **Bridge image → text with a vision LLM.** `gpt-4o-mini` takes the photo
  (and the optional user prompt) and returns a structured JSON payload of
  attributes plus a one-sentence search description. The category field is
  constrained at the schema level to the catalog's exact 15-value enum, so
  the model can't emit a free-form category that fails the filter.
  ([backend/src/providers/openai.ts](backend/src/providers/openai.ts))
- **Build the query from the description, not the raw attributes.** The
  description is dense, natural language and aligns well with how titles
  and descriptions are written in the catalog. The user prompt is
  appended verbatim so user intent shows up in the same `$text` bag.
  ([backend/src/pipeline/queryBuild.ts](backend/src/pipeline/queryBuild.ts))
- **Hard-filter on category, keep the rest soft.** Category is the one
  attribute we trust enough to filter on (enum-constrained, low
  cardinality, evenly distributed). Type/style/material/color stay in the
  text query as soft signals — bad model guesses then degrade ranking
  rather than zeroing out the result set. If canonicalization fails, the
  filter is dropped entirely.
- **Rank by Mongo `textScore`, take top-K.** `$text` ranking with
  `{ $meta: "textScore" }` is good enough as a baseline given the weighted
  index; `topK` is admin-tunable (default 20).
  ([backend/src/catalog/search.ts](backend/src/catalog/search.ts))
- **Rerank seam, stub today.** The pipeline has a `rerank` stage behind a
  config flag. The intent is to feed the top-K back to a vision LLM with
  the original image and re-order based on visual fit; the seam ships
  empty so wiring it on later is a flag flip.
  ([backend/src/pipeline/rerank.ts](backend/src/pipeline/rerank.ts))

### Key design choices and tradeoffs

- **Pipeline-shaped, not framework-shaped.** Each stage is a pure-ish
  module with typed input/output and injected dependencies. The
  orchestrator owns no singletons; tests swap stages directly.
  ([backend/src/pipeline/run.ts](backend/src/pipeline/run.ts))
- **Read-only catalog, in-memory config.** The challenge constrains the DB
  to read-only and the spec is light on persistence requirements. Admin
  config (top-K, rerank flag, model choice) lives in a single in-memory
  store rather than a sidecar DB. Trade: config resets on restart; we
  accept that for simplicity.
  ([backend/src/config/store.ts](backend/src/config/store.ts))
- **Provider abstraction over a single shape.** All LLM calls go through
  one `Provider` interface so swapping providers (or stubbing them in
  tests) is one import. Pricing is owned at the provider layer because
  cost calculation depends on per-model rates.
  ([backend/src/providers/types.ts](backend/src/providers/types.ts),
  [backend/src/providers/pricing.ts](backend/src/providers/pricing.ts))
- **API key is per-request, never server config.** The frontend keeps the
  key in component state (no `localStorage`), forwards it as `x-api-key`,
  and the backend treats it as a per-request credential. Never logged,
  never echoed in errors.
- **Graceful edges, loud middle.** Internal code throws; the API handler
  catches and translates to a small set of structured error codes
  (`UNRECOGNIZED_IMAGE`, `PROVIDER_ERROR`, low-confidence flag on empty
  results). The frontend renders each as a distinct affordance.
- **Separate diag from eval.** A dev-only diagnostic panel surfaces
  per-request stage latencies, tokens, and cost. The eval harness uses a
  frozen 30-item gold set and writes append-only history. Different jobs,
  different surfaces — see "Eval" further down.

## Future enhancements

In rough priority order, what I'd build next:

1. **Land the LLM rerank.** The seam is in place; the missing piece is a
   vision-LLM call that takes top-K candidates plus the original image
   and re-orders them. Highest expected lift on result quality and
   already admin-flagged.
2. **Admin UI.** Plan exists at [plans/admin-ui.md](plans/admin-ui.md):
   simple password-gated page that exposes the in-memory config (top-K,
   rerank, model), shows a pipeline diagram, and renders the eval
   `history.jsonl` for tracking quality across config changes.
3. **Attribute-weighted scoring.** Layer a local re-rank that boosts hits
   matching extracted attributes (style, material, color) before — or
   instead of — the LLM rerank. Cheaper than an LLM call, narrower lift.
4. **Filter strictness as a knob.** Today category is a hard filter and
   everything else is soft. An admin-tunable strictness (e.g. add `type`
   as a hard filter when confidence is high) would help precision on
   queries the vision model nails.
5. **Pluggable providers beyond OpenAI.** The provider interface is
   already abstract; adding Anthropic / Gemini is mostly an adapter and
   pricing entry. Useful for cost/quality A/B and for users who don't
   have an OpenAI key.
6. **Real per-document scores.** `catalogSearch` synthesizes a positional
   score for the diag panel because the query layer doesn't yet thread
   `textScore` through to the response. Wire it through and the diag
   panel and eval get a real signal to track.

---

## Developer reference

Everything below is for working on the code rather than running a demo.

### Run without Docker

```bash
# in one terminal
cd backend && npm install && npm run dev

# in another
cd frontend && npm install && npm run dev
```

### Diagnostic panel (dev only)

When the frontend is running under Vite dev mode (`npm run dev` or
`docker compose up`), a collapsible **Diagnostics** panel appears beneath
the results grid after every successful search. It surfaces:

- the attributes the vision stage extracted from the image,
- the best-effort built query string,
- the top-3 raw catalog hits with their scores,
- per-stage execution order and total latency,
- prompt / completion / total token counts,
- and the USD cost of the LLM calls (5-decimal precision).

The panel is gated on `import.meta.env.DEV` and is stripped from
production builds — it never ships to public users.

### Inspect the catalog

```bash
node --env-file=.env scripts/explore-db.mjs
```

Prints the indexes, a small sample, a field-type table, and the distinct
values for the categorical fields. See
[docs/catalog-schema.md](docs/catalog-schema.md) for the snapshot this
project was built against.

### Tests

```bash
cd backend && npm test     # unit tests
cd frontend && npm test    # unit tests
```

The end-to-end smoke that hits real OpenAI + Atlas is gated behind
`RUN_E2E=1`. It skips cleanly when the env is not set:

```bash
cd backend
RUN_E2E=1 OPENAI_API_KEY=sk-... DB_URL=mongodb+srv://... npm test -- test/e2e
```

The fixture image lives at `backend/test/fixtures/sofa.jpg`.

### Eval

A lightweight, local-only eval harness scores the pipeline against a
frozen gold set of 30 generated room photos (2 per category × 15
categories) plus a small manual subset of real-world photos for human
eyeballing.

**Prerequisites:**

- A populated `.env` at the repo root with `DB_URL`.
- An OpenAI API key. **Each script that needs it prompts for the key on
  stdin with input hidden** — the value lives in process memory only,
  never written to disk, never logged, never echoed. If you prefer not
  to paste each run, export `OPENAI_API_KEY` in your shell for the
  session and the prompt is skipped; do not put the key in `.env` or
  any committed file.

The harness is local-only by design: it hits paid APIs and the live
catalog, so it never runs in CI.

**One-time fixture build.** The gold-set fixtures are committed to the
repo. To (re)generate them on a fresh checkout, run from `backend/`:

```bash
cd backend
npm run gold:sample      # stratified sample from Mongo (no OpenAI key needed)
npm run gold:generate    # prompts for OpenAI key -> gpt-image-1 -> JPEGs
npm run gold:attrs       # prompts for OpenAI key -> gpt-4o-mini -> sidecars
npm run manual:fetch     # ~10 real-world photos (no OpenAI key needed)
```

`gold:generate` and `gold:attrs` are idempotent — both skip files that
already exist, so a partial failure (e.g. running out of OpenAI credits)
re-runs cleanly without re-billing for completed items.

**Run the eval.**

```bash
cd backend
npm run eval             # prompts for OpenAI key on stdin
```

The runner iterates every gold sidecar under
`backend/eval/fixtures/gold/`, feeds the paired JPEG through
`runPipeline`, scores each response, and prints two sections to stdout:

- **Overall**: `recall@1/5/20`, MRR, category- and type-hit rates, mean
  attribute Jaccard, p50/p95 latency, total tokens, USD cost,
  failure-mode counts.
- **By category**: the same metrics broken down per `category`.

After printing, the harness appends one JSON line to
`backend/eval/history.jsonl` recording the run's git SHA, dirty flag,
the admin-tunable config snapshot, the gold-set version, and the metric
aggregates. The file is append-only — every run preserves prior rows so
you can diff metrics across configs by tailing it.

If `DB_URL` is missing the runner exits cleanly with a stderr message
and does not call any API. If the OpenAI key is missing the runner
prompts for it interactively; piping a non-TTY stdin will fail loudly
rather than block.

### Troubleshooting

- **OpenAI key rejected (401 / 502 with `PROVIDER_ERROR`)**: confirm the
  key is current, has access to the vision-capable model
  (default `gpt-4o-mini`), and has remaining quota. The backend never
  caches keys — re-paste in the UI to retry.
- **`DB_URL is not set` on backend boot**: the backend looked at
  `process.env.DB_URL` and found nothing. Make sure `.env` exists at
  the repo root and that whichever runner you're using loads it
  (Docker Compose loads it automatically; for `npm run dev` use
  `node --env-file=.env` or your shell's dotenv equivalent).
- **Mongo connection hangs / `ENOTFOUND`**: check the URI host, your
  network, and that the Atlas cluster's IP allow-list includes you.
  Re-run `node --env-file=.env scripts/explore-db.mjs` to confirm
  connectivity outside the app.
- **Empty results with `lowConfidence: true`**: the catalog had no
  strong text matches for the extracted attributes. Try a clearer photo
  or a more specific prompt. The grid still shows the best-effort top
  results when there are any.
- **`UNRECOGNIZED_IMAGE` (422)**: the vision model couldn't make sense
  of the upload. Try a less abstract image.
- **`Cannot find package '<name>'` after adding a backend/frontend
  dependency**: `node_modules` lives in a named Docker volume populated
  from the image on **first** boot only. Rebuilding the image alone
  does not refresh the existing volume. Either run
  `docker compose down -v` before `docker compose up` (drops the
  volume so it repopulates), or `docker compose exec backend npm install`
  (installs into the running volume).
