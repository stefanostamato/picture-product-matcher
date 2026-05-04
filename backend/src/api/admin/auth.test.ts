import { describe, it, expect, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import requireAdminPassword, { getExpectedPassword } from "./auth.js";

function makeApp(): express.Express {
  const app = express();
  app.get("/probe", requireAdminPassword, (_req, res) => {
    res.status(200).json({ ok: true });
  });
  return app;
}

describe("requireAdminPassword middleware", () => {
  const originalEnv = process.env.ADMIN_PASSWORD;

  beforeEach(() => {
    delete process.env.ADMIN_PASSWORD;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.ADMIN_PASSWORD;
    } else {
      process.env.ADMIN_PASSWORD = originalEnv;
    }
  });

  it("returns 401 ADMIN_AUTH_REQUIRED when the header is missing", async () => {
    const res = await request(makeApp()).get("/probe");
    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      code: "ADMIN_AUTH_REQUIRED",
      message: "Admin password required.",
    });
  });

  it("returns 401 ADMIN_AUTH_INVALID for the wrong password and never echoes it", async () => {
    const supplied = "totally-wrong-secret-xyz";
    const res = await request(makeApp())
      .get("/probe")
      .set("x-admin-password", supplied);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      code: "ADMIN_AUTH_INVALID",
      message: "Invalid admin password.",
    });
    // Defence in depth: the supplied value must not appear anywhere in the
    // response body, even via incidental error formatting.
    expect(JSON.stringify(res.body)).not.toContain(supplied);
    expect(res.text).not.toContain(supplied);
  });

  it("calls next and returns 200 when the password matches", async () => {
    const res = await request(makeApp())
      .get("/probe")
      .set("x-admin-password", "admin");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("defaults the expected password to 'admin' when ADMIN_PASSWORD is unset", () => {
    delete process.env.ADMIN_PASSWORD;
    expect(getExpectedPassword()).toBe("admin");
  });

  it("honors a custom ADMIN_PASSWORD env value", async () => {
    process.env.ADMIN_PASSWORD = "hunter2";
    expect(getExpectedPassword()).toBe("hunter2");

    const wrong = await request(makeApp())
      .get("/probe")
      .set("x-admin-password", "admin");
    expect(wrong.status).toBe(401);
    expect(wrong.body.code).toBe("ADMIN_AUTH_INVALID");

    const right = await request(makeApp())
      .get("/probe")
      .set("x-admin-password", "hunter2");
    expect(right.status).toBe(200);
  });

  it("treats an empty-string ADMIN_PASSWORD as unset and falls back to 'admin'", async () => {
    process.env.ADMIN_PASSWORD = "";
    expect(getExpectedPassword()).toBe("admin");

    const res = await request(makeApp())
      .get("/probe")
      .set("x-admin-password", "admin");
    expect(res.status).toBe(200);
  });
});
