import { describe, it, expect, beforeEach, afterEach } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { registerAdminRoutes } from "./routes.js";
import {
  setConfigFilePath,
  reloadConfigFromDisk,
  resetConfig,
  DEFAULT_VISION_PROMPT,
  DEFAULT_RERANK_PROMPT,
} from "../../config/store.js";

const PASSWORD = "admin";

function makeApp(historyPath: string): Express {
  const app = express();
  app.use(express.json());
  registerAdminRoutes(app, { historyPath });
  return app;
}

describe("admin routes", () => {
  let tmpDir: string;
  let configFile: string;
  let historyFile: string;
  let app: Express;

  beforeEach(async () => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "admin-routes-test-"));
    configFile = path.join(tmpDir, "config.json");
    historyFile = path.join(tmpDir, "history.jsonl");
    setConfigFilePath(configFile);
    reloadConfigFromDisk();
    await resetConfig();
    app = makeApp(historyFile);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("auth gating", () => {
    it("GET /admin/config returns 401 without x-admin-password", async () => {
      const res = await request(app).get("/admin/config");
      expect(res.status).toBe(401);
      expect(res.body.code).toBe("ADMIN_AUTH_REQUIRED");
    });

    it("POST /admin/config returns 401 without x-admin-password", async () => {
      const res = await request(app).post("/admin/config").send({ topK: 5 });
      expect(res.status).toBe(401);
      expect(res.body.code).toBe("ADMIN_AUTH_REQUIRED");
    });

    it("POST /admin/config/reset returns 401 without x-admin-password", async () => {
      const res = await request(app).post("/admin/config/reset");
      expect(res.status).toBe(401);
      expect(res.body.code).toBe("ADMIN_AUTH_REQUIRED");
    });

    it("GET /admin/history returns 401 without x-admin-password", async () => {
      const res = await request(app).get("/admin/history");
      expect(res.status).toBe(401);
      expect(res.body.code).toBe("ADMIN_AUTH_REQUIRED");
    });
  });

  describe("GET /admin/config", () => {
    it("returns the live config including visionPrompt", async () => {
      const res = await request(app)
        .get("/admin/config")
        .set("x-admin-password", PASSWORD);
      expect(res.status).toBe(200);
      expect(res.body.visionPrompt).toBe(DEFAULT_VISION_PROMPT);
      expect(res.body.rerankPrompt).toBe(DEFAULT_RERANK_PROMPT);
      expect(res.body.topK).toBe(20);
      expect(res.body.rerank).toBe(true);
      expect(res.body.provider).toBe("openai");
    });
  });

  describe("POST /admin/config", () => {
    it("accepts a valid update, persists it, and returns merged config", async () => {
      const res = await request(app)
        .post("/admin/config")
        .set("x-admin-password", PASSWORD)
        .send({ topK: 5 });
      expect(res.status).toBe(200);
      expect(res.body.topK).toBe(5);
      expect(res.body.visionPrompt).toBe(DEFAULT_VISION_PROMPT);

      // Persistence: tmp config.json now exists.
      expect(existsSync(configFile)).toBe(true);

      // Second GET confirms in-memory store kept it.
      const next = await request(app)
        .get("/admin/config")
        .set("x-admin-password", PASSWORD);
      expect(next.status).toBe(200);
      expect(next.body.topK).toBe(5);
    });

    it("returns 400 ADMIN_CONFIG_INVALID for an invalid value", async () => {
      const res = await request(app)
        .post("/admin/config")
        .set("x-admin-password", PASSWORD)
        .send({ topK: -1 });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("ADMIN_CONFIG_INVALID");
      expect(typeof res.body.message).toBe("string");
      expect(res.body.message.length).toBeGreaterThan(0);
    });

    it("returns 400 for an unknown key", async () => {
      const res = await request(app)
        .post("/admin/config")
        .set("x-admin-password", PASSWORD)
        .send({ unknownKey: 1 });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("ADMIN_CONFIG_INVALID");
    });
  });

  describe("POST /admin/config/reset", () => {
    it("removes the tmp config.json and a subsequent GET returns defaults", async () => {
      await request(app)
        .post("/admin/config")
        .set("x-admin-password", PASSWORD)
        .send({ topK: 7 });
      expect(existsSync(configFile)).toBe(true);

      const reset = await request(app)
        .post("/admin/config/reset")
        .set("x-admin-password", PASSWORD);
      expect(reset.status).toBe(200);
      expect(reset.body.topK).toBe(20);
      expect(existsSync(configFile)).toBe(false);

      const after = await request(app)
        .get("/admin/config")
        .set("x-admin-password", PASSWORD);
      expect(after.body.topK).toBe(20);
    });
  });

  describe("GET /admin/history", () => {
    it("returns { rows: [] } when the file is missing", async () => {
      const res = await request(app)
        .get("/admin/history")
        .set("x-admin-password", PASSWORD);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ rows: [] });
    });

    it("returns rows newest-first and reports skipped malformed lines via header", async () => {
      const lines = [
        JSON.stringify({ ts: "2026-01-01T00:00:00Z", marker: "first" }),
        JSON.stringify({ ts: "2026-02-01T00:00:00Z", marker: "second" }),
        "{ broken json line",
        JSON.stringify({ ts: "2026-03-01T00:00:00Z", marker: "third" }),
      ];
      writeFileSync(historyFile, lines.join("\n") + "\n");

      const res = await request(app)
        .get("/admin/history")
        .set("x-admin-password", PASSWORD);
      expect(res.status).toBe(200);
      expect(res.body.rows).toHaveLength(3);
      expect(res.headers["x-history-skipped"]).toBe("1");
      // Newest-first: file is append-by-time, so the last appended is first.
      expect(res.body.rows[0].marker).toBe("third");
      expect(res.body.rows[1].marker).toBe("second");
      expect(res.body.rows[2].marker).toBe("first");
    });

    it("caps at 100 when the file has 150 lines and returns the 100 newest", async () => {
      const lines: string[] = [];
      for (let i = 0; i < 150; i += 1) {
        lines.push(JSON.stringify({ idx: i }));
      }
      writeFileSync(historyFile, lines.join("\n") + "\n");

      const res = await request(app)
        .get("/admin/history")
        .set("x-admin-password", PASSWORD);
      expect(res.status).toBe(200);
      expect(res.body.rows).toHaveLength(100);
      // Newest-first: first row is index 149, last is 50.
      expect(res.body.rows[0].idx).toBe(149);
      expect(res.body.rows[99].idx).toBe(50);
    });

    it("ignores empty lines silently (no skipped count)", async () => {
      const lines = [
        JSON.stringify({ idx: 1 }),
        "",
        JSON.stringify({ idx: 2 }),
        "",
      ];
      writeFileSync(historyFile, lines.join("\n"));

      const res = await request(app)
        .get("/admin/history")
        .set("x-admin-password", PASSWORD);
      expect(res.status).toBe(200);
      expect(res.body.rows).toHaveLength(2);
      expect(res.headers["x-history-skipped"]).toBe("0");
    });
  });
});
