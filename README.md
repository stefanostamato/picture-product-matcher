# picture-product-matcher

A web app that turns an uploaded photo into ranked product matches against
First Chair's catalog. Optional natural-language prompt narrows results.
Users supply their own model-provider API key at runtime; it is held in
memory only.

## Run

```bash
docker compose up
```

- Frontend: http://localhost:5173
- Backend:  http://localhost:3001

Hot-reload is wired via host bind mounts. First boot installs deps inside
the containers (slower); subsequent boots are fast.

## Run without Docker

```bash
# in one terminal
cd backend && npm install && npm run dev

# in another
cd frontend && npm install && npm run dev
```

## Run a search

1. Start the stack with `docker compose up` (or the two-terminal flow above).
2. Open http://localhost:5173 in your browser.
3. Paste your OpenAI API key into the **API key** field. The key stays in
   memory only — it is never written to disk, never sent to the backend
   except as the per-request `x-api-key` header, and never logged.
4. Drop or pick an image (JPEG / PNG / WebP, ≤ 8MB).
5. Optionally add a prompt to refine the search (e.g. "rustic, oak").
6. Submit. The backend extracts attributes from the image with the vision
   model, builds a text query, runs it against the catalog, and returns a
   ranked grid of products. A low-confidence banner appears when the
   catalog has no strong matches; an error banner appears if the provider
   or backend rejects the request.

## Required env vars

Copy `.env.example` to `.env` at the repo root and fill in real values:

| Key | Required | Default | Notes |
| --- | --- | --- | --- |
| `DB_URL` | yes | — | MongoDB Atlas connection string for the read-only catalog. |
| `DB_NAME` | no | `catalog` | Override only if your URI points at a different DB. |
| `COLLECTION_NAME` | no | `products` | Override only if the collection name differs. |

The OpenAI key is **not** an env var — it is supplied per-request from the
UI and forwarded as `x-api-key`.

## Database setup

The catalog lives in a hosted MongoDB Atlas cluster and is **read-only**.

1. Copy the env template and fill in the connection string you were given:

   ```bash
   cp .env.example .env
   # then edit .env and set DB_URL=mongodb+srv://USER:PASSWORD@CLUSTER.mongodb.net/catalog?...
   ```

   `.env` is gitignored. The database name (`catalog`) is encoded in the
   URI path. The collection (`products`) is auto-detected. If you need to
   override either, set `DB_NAME` and/or `COLLECTION_NAME` — both are
   present (commented out) in `.env.example`.

2. Verify the connection and inspect the schema:

   ```bash
   node --env-file=.env scripts/explore-db.mjs
   ```

   Prints the indexes, a small sample, a field-type table, and the
   distinct values for the categorical fields. See
   `docs/catalog-schema.md` for the snapshot this project was built
   against.

## Tests

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

## Troubleshooting

- **OpenAI key rejected (401 / 502 with `PROVIDER_ERROR`)**: confirm the
  key is current, has access to the vision-capable model
  (default `gpt-4o-mini`), and has remaining quota. The backend never
  caches keys — re-paste in the UI to retry.
- **`DB_URL is not set` on backend boot**: the backend looked at
  `process.env.DB_URL` and found nothing. Make sure `.env` exists at the
  repo root and that whichever runner you're using loads it (Docker
  Compose loads it automatically; for `npm run dev` use
  `node --env-file=.env` or your shell's dotenv equivalent).
- **Mongo connection hangs / `ENOTFOUND`**: check the URI host, your
  network, and that the Atlas cluster's IP allow-list includes you.
  Re-run `node --env-file=.env scripts/explore-db.mjs` to confirm
  connectivity outside the app.
- **Empty results with `lowConfidence: true`**: the catalog had no strong
  text matches for the extracted attributes. Try a clearer photo or a
  more specific prompt. The grid still shows the best-effort top results
  when there are any.
- **`UNRECOGNIZED_IMAGE` (422)**: the vision model couldn't make sense of
  the upload. Try a less abstract image.
- **`Cannot find package '<name>'` after adding a backend/frontend
  dependency**: `node_modules` lives in a named Docker volume that is
  populated from the image on **first** boot only. Rebuilding the image
  alone does not refresh the existing volume. Either run
  `docker compose down -v` before `docker compose up` (drops the volume
  so it repopulates), or `docker compose exec backend npm install`
  (installs into the running volume).
