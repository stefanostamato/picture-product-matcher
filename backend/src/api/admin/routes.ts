import type { Express, Request, Response } from "express";
import express from "express";
import { readFile } from "node:fs/promises";
import path from "node:path";
import requireAdminPassword from "./auth.js";
import {
  getConfig,
  setConfig,
  resetConfig,
  validateConfig,
} from "../../config/store.js";
import type { AdminConfig, HistoryRow, HistoryResponse } from "shared/wire";

interface RegisterAdminRoutesDeps {
  /** Path to the eval-harness history JSONL file. Injectable for tests. */
  historyPath?: string;
}

const HISTORY_CAP = 100;
const DEFAULT_HISTORY_PATH = path.resolve(process.cwd(), "eval/history.jsonl");

/**
 * Mount the admin surface (`GET /admin/config`, `POST /admin/config`,
 * `POST /admin/config/reset`, `GET /admin/history`) on the given Express app.
 * Every route is gated by the `requireAdminPassword` middleware applied at
 * registration time so a public caller cannot probe these URLs even with a
 * misconfigured client.
 */
export function registerAdminRoutes(
  app: Express,
  deps: RegisterAdminRoutesDeps = {},
): void {
  const historyPath = deps.historyPath ?? DEFAULT_HISTORY_PATH;

  // JSON body parser, scoped to the admin surface so the public `/search`
  // multipart route is unaffected.
  const jsonBody = express.json();

  app.get("/admin/config", requireAdminPassword, (_req: Request, res: Response) => {
    res.status(200).json(toAdminConfig(getConfig()));
  });

  app.post(
    "/admin/config",
    requireAdminPassword,
    jsonBody,
    async (req: Request, res: Response) => {
      const body = (req.body ?? {}) as unknown;
      const result = validateConfig(body);
      if (!result.ok) {
        res.status(400).json({
          code: "ADMIN_CONFIG_INVALID",
          message: result.errors.join("; "),
        });
        return;
      }
      try {
        const next = await setConfig(result.value);
        res.status(200).json(toAdminConfig(next));
      } catch (err) {
        // setConfig validates again internally; if it threw, treat as 400
        // with a scrubbed message so we never echo internal stack traces.
        res.status(400).json({
          code: "ADMIN_CONFIG_INVALID",
          message: err instanceof Error ? err.message : "Invalid config update.",
        });
      }
    },
  );

  app.post(
    "/admin/config/reset",
    requireAdminPassword,
    async (_req: Request, res: Response) => {
      await resetConfig();
      res.status(200).json(toAdminConfig(getConfig()));
    },
  );

  app.get(
    "/admin/history",
    requireAdminPassword,
    async (_req: Request, res: Response) => {
      try {
        const { rows, skipped } = await readHistory(historyPath);
        res.set("x-history-skipped", String(skipped));
        const body: HistoryResponse = { rows };
        res.status(200).json(body);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "ENOENT") {
          res.set("x-history-skipped", "0");
          const body: HistoryResponse = { rows: [] };
          res.status(200).json(body);
          return;
        }
        res.status(503).json({
          code: "ADMIN_HISTORY_UNAVAILABLE",
          message: "Could not read eval history.",
        });
      }
    },
  );
}

function toAdminConfig(config: ReturnType<typeof getConfig>): AdminConfig {
  return {
    topK: config.topK,
    rerank: config.rerank,
    provider: config.provider,
    visionModel: config.visionModel,
    visionPrompt: config.visionPrompt,
    rerankModel: config.rerankModel,
    rerankPrompt: config.rerankPrompt,
    rerankTopN: config.rerankTopN,
  };
}

async function readHistory(
  filePath: string,
): Promise<{ rows: HistoryRow[]; skipped: number }> {
  const raw = await readFile(filePath, "utf8");
  const lines = raw.split("\n");
  const parsed: HistoryRow[] = [];
  let skipped = 0;
  for (const line of lines) {
    if (line.length === 0) continue;
    try {
      parsed.push(JSON.parse(line) as HistoryRow);
    } catch {
      skipped += 1;
    }
  }
  // File is append-only-by-time; newest-first means reversing then capping.
  const reversed = parsed.reverse();
  return { rows: reversed.slice(0, HISTORY_CAP), skipped };
}
