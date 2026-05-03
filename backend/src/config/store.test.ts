import { describe, it, expect, beforeEach } from "vitest";
import { getConfig, setConfig, resetConfig } from "./store.js";

describe("config store", () => {
  beforeEach(() => {
    resetConfig();
  });

  it("exposes the documented defaults", () => {
    expect(getConfig()).toEqual({
      topK: 20,
      rerank: false,
      provider: "openai",
      visionModel: "gpt-4o-mini",
    });
  });

  it("returns a fresh object each call so callers cannot mutate internal state", () => {
    const first = getConfig();
    first.topK = 999;
    expect(getConfig().topK).toBe(20);
  });

  it("applies a partial update without disturbing untouched keys", () => {
    setConfig({ topK: 5 });
    expect(getConfig()).toEqual({
      topK: 5,
      rerank: false,
      provider: "openai",
      visionModel: "gpt-4o-mini",
    });
  });

  it("supports overriding multiple keys at once", () => {
    setConfig({ rerank: true, visionModel: "gpt-4o" });
    const config = getConfig();
    expect(config.rerank).toBe(true);
    expect(config.visionModel).toBe("gpt-4o");
    expect(config.topK).toBe(20);
    expect(config.provider).toBe("openai");
  });

  it("ignores undefined values in a partial update", () => {
    setConfig({ topK: 7 });
    setConfig({ topK: undefined });
    expect(getConfig().topK).toBe(7);
  });

  it("resetConfig restores defaults", () => {
    setConfig({ topK: 1, rerank: true, provider: "openai", visionModel: "x" });
    resetConfig();
    expect(getConfig()).toEqual({
      topK: 20,
      rerank: false,
      provider: "openai",
      visionModel: "gpt-4o-mini",
    });
  });
});
