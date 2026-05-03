import express, { type Express } from "express";
import cors from "cors";
import { registerSearchRoute } from "./api/search.js";

const DEFAULT_ALLOWED_ORIGINS = ["http://localhost:5173"];

export function createApp(): Express {
  const app = express();

  const origins = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(",").map((o) => o.trim())
    : DEFAULT_ALLOWED_ORIGINS;
  app.use(cors({ origin: origins, allowedHeaders: ["Content-Type", "x-api-key"] }));

  app.get("/health", (_req, res) => {
    res.status(200).json({ ok: true });
  });

  registerSearchRoute(app);

  return app;
}

export const app = createApp();
