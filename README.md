# picture-product-matcher

## Run

```bash
docker compose up
```

- Frontend: http://localhost:5173
- Backend:  http://localhost:3001

Hot-reload is wired via host bind mounts. First boot installs deps inside the containers (slower); subsequent boots are fast.

## Run without Docker

```bash
# in one terminal
cd backend && npm install && npm run dev

# in another
cd frontend && npm install && npm run dev
```

## API key

The app expects you to paste a model-provider API key in the UI at runtime. It is held in memory only — never persisted, never sent anywhere except the chosen provider.
