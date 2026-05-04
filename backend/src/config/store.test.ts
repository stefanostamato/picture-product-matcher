import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  getConfig,
  setConfig,
  resetConfig,
  validateConfig,
  setConfigFilePath,
  reloadConfigFromDisk,
  CONFIG_FILE_PATH,
  DEFAULT_VISION_PROMPT,
  DEFAULT_RERANK_PROMPT,
  type Config,
} from "./store.js";

const DEFAULTS: Config = {
  topK: 20,
  rerank: true,
  provider: "openai",
  visionModel: "gpt-4o-mini",
  visionPrompt: DEFAULT_VISION_PROMPT,
  rerankModel: "gpt-4o-mini",
  rerankPrompt: DEFAULT_RERANK_PROMPT,
  rerankTopN: 20,
};

describe("config store", () => {
  let tmpDir: string;
  let tmpFile: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(tmpdir(), "config-store-test-"));
    tmpFile = path.join(tmpDir, "config.json");
    setConfigFilePath(tmpFile);
    reloadConfigFromDisk();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("exposes the documented defaults including new prompt knobs", () => {
    expect(getConfig()).toEqual(DEFAULTS);
  });

  it("returns a fresh object each call so callers cannot mutate internal state", () => {
    const first = getConfig();
    first.topK = 999;
    expect(getConfig().topK).toBe(20);
  });

  it("default rerank is true and rerankTopN is 20", () => {
    const config = getConfig();
    expect(config.rerank).toBe(true);
    expect(config.rerankTopN).toBe(20);
    expect(config.rerankModel).toBe("gpt-4o-mini");
    expect(config.rerankPrompt).toBe(DEFAULT_RERANK_PROMPT);
    expect(config.visionPrompt).toBe(DEFAULT_VISION_PROMPT);
  });

  it("boot with no file: getConfig returns defaults and no file is written", () => {
    expect(existsSync(tmpFile)).toBe(false);
    expect(getConfig()).toEqual(DEFAULTS);
    expect(existsSync(tmpFile)).toBe(false);
  });

  it("boot with valid file: file values override defaults", () => {
    writeFileSync(
      tmpFile,
      JSON.stringify({ topK: 7, rerank: false, visionModel: "gpt-4o" }),
    );
    reloadConfigFromDisk();
    const config = getConfig();
    expect(config.topK).toBe(7);
    expect(config.rerank).toBe(false);
    expect(config.visionModel).toBe("gpt-4o");
    expect(config.rerankModel).toBe("gpt-4o-mini");
  });

  it("boot with corrupt JSON: defaults returned, warning logged, no crash", () => {
    writeFileSync(tmpFile, "{ this is not json");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    reloadConfigFromDisk();
    expect(getConfig()).toEqual(DEFAULTS);
    expect(warnSpy).toHaveBeenCalled();
  });

  it("boot with valid JSON but invalid values: defaults returned, warning logged", () => {
    writeFileSync(tmpFile, JSON.stringify({ topK: -1 }));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    reloadConfigFromDisk();
    expect(getConfig()).toEqual(DEFAULTS);
    expect(warnSpy).toHaveBeenCalled();
  });

  it("boot with rerankTopN out of range: defaults returned, warning logged", () => {
    writeFileSync(tmpFile, JSON.stringify({ rerankTopN: 99 }));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    reloadConfigFromDisk();
    expect(getConfig()).toEqual(DEFAULTS);
    expect(warnSpy).toHaveBeenCalled();
  });

  it("setConfig writes a file containing the merged config; subsequent setConfig preserves prior keys on disk", async () => {
    await setConfig({ topK: 5 });
    expect(existsSync(tmpFile)).toBe(true);
    const first = JSON.parse(readFileSync(tmpFile, "utf8"));
    expect(first.topK).toBe(5);
    expect(first.rerank).toBe(true);

    await setConfig({ rerank: false });
    const second = JSON.parse(readFileSync(tmpFile, "utf8"));
    expect(second.topK).toBe(5);
    expect(second.rerank).toBe(false);
  });

  it("setConfig with invalid value throws and disk file is unchanged", async () => {
    await setConfig({ topK: 5 });
    const before = readFileSync(tmpFile, "utf8");
    await expect(setConfig({ topK: -1 } as Partial<Config>)).rejects.toThrow();
    const after = readFileSync(tmpFile, "utf8");
    expect(after).toBe(before);
  });

  it("setConfig with unknown key throws and disk file is unchanged", async () => {
    await setConfig({ topK: 5 });
    const before = readFileSync(tmpFile, "utf8");
    await expect(
      setConfig({ unknownKey: 1 } as unknown as Partial<Config>),
    ).rejects.toThrow();
    const after = readFileSync(tmpFile, "utf8");
    expect(after).toBe(before);
  });

  it("resetConfig removes the file and restores defaults", async () => {
    await setConfig({ topK: 5 });
    expect(existsSync(tmpFile)).toBe(true);
    await resetConfig();
    expect(existsSync(tmpFile)).toBe(false);
    expect(getConfig()).toEqual(DEFAULTS);
  });

  it("resetConfig is a no-op when the file does not exist", async () => {
    expect(existsSync(tmpFile)).toBe(false);
    await expect(resetConfig()).resolves.toBeUndefined();
    expect(getConfig()).toEqual(DEFAULTS);
  });

  it("ignores undefined values in a partial update", async () => {
    await setConfig({ topK: 7 });
    await setConfig({ topK: undefined });
    expect(getConfig().topK).toBe(7);
  });

  it("setConfig is atomic: no .tmp file lingers after a successful write", async () => {
    await setConfig({ topK: 5 });
    const tmpArtifact = `${tmpFile}.tmp`;
    expect(existsSync(tmpArtifact)).toBe(false);
  });

  it("CONFIG_FILE_PATH is exported as a string", () => {
    expect(typeof CONFIG_FILE_PATH).toBe("string");
  });

  describe("validateConfig", () => {
    it("rejects topK outside [1, 100]", () => {
      expect(validateConfig({ topK: 0 })).toEqual({
        ok: false,
        errors: expect.arrayContaining([expect.stringMatching(/topK/)]),
      });
      expect(validateConfig({ topK: 101 })).toMatchObject({ ok: false });
      expect(validateConfig({ topK: 1.5 })).toMatchObject({ ok: false });
    });

    it("accepts topK within [1, 100]", () => {
      expect(validateConfig({ topK: 50 })).toEqual({
        ok: true,
        value: { topK: 50 },
      });
      expect(validateConfig({ topK: 1 })).toMatchObject({ ok: true });
      expect(validateConfig({ topK: 100 })).toMatchObject({ ok: true });
    });

    it("rejects unknown keys", () => {
      expect(validateConfig({ unknownKey: 1 })).toMatchObject({ ok: false });
    });

    it("rejects rerankTopN > 50", () => {
      expect(validateConfig({ rerankTopN: 51 })).toMatchObject({ ok: false });
    });

    it("accepts rerankTopN within [1, 50]", () => {
      expect(validateConfig({ rerankTopN: 5 })).toEqual({
        ok: true,
        value: { rerankTopN: 5 },
      });
      expect(validateConfig({ rerankTopN: 1 })).toMatchObject({ ok: true });
      expect(validateConfig({ rerankTopN: 50 })).toMatchObject({ ok: true });
    });

    it("rejects rerankTopN < 1 or non-integer", () => {
      expect(validateConfig({ rerankTopN: 0 })).toMatchObject({ ok: false });
      expect(validateConfig({ rerankTopN: 2.5 })).toMatchObject({ ok: false });
    });

    it("validates boolean rerank", () => {
      expect(validateConfig({ rerank: true })).toMatchObject({ ok: true });
      expect(validateConfig({ rerank: false })).toMatchObject({ ok: true });
      expect(validateConfig({ rerank: "yes" })).toMatchObject({ ok: false });
    });

    it("validates provider must equal 'openai'", () => {
      expect(validateConfig({ provider: "openai" })).toMatchObject({ ok: true });
      expect(validateConfig({ provider: "anthropic" })).toMatchObject({
        ok: false,
      });
    });

    it("validates visionModel non-empty string up to 200 chars", () => {
      expect(validateConfig({ visionModel: "" })).toMatchObject({ ok: false });
      expect(validateConfig({ visionModel: "x".repeat(201) })).toMatchObject({
        ok: false,
      });
      expect(validateConfig({ visionModel: "gpt-4o" })).toMatchObject({
        ok: true,
      });
    });

    it("validates visionPrompt non-empty string up to 2000 chars", () => {
      expect(validateConfig({ visionPrompt: "" })).toMatchObject({ ok: false });
      expect(validateConfig({ visionPrompt: "x".repeat(2001) })).toMatchObject({
        ok: false,
      });
      expect(validateConfig({ visionPrompt: "do the thing" })).toMatchObject({
        ok: true,
      });
    });

    it("validates rerankModel non-empty string up to 200 chars", () => {
      expect(validateConfig({ rerankModel: "" })).toMatchObject({ ok: false });
      expect(validateConfig({ rerankModel: "x".repeat(201) })).toMatchObject({
        ok: false,
      });
      expect(validateConfig({ rerankModel: "gpt-4o-mini" })).toMatchObject({
        ok: true,
      });
    });

    it("validates rerankPrompt non-empty string up to 2000 chars", () => {
      expect(validateConfig({ rerankPrompt: "" })).toMatchObject({ ok: false });
      expect(validateConfig({ rerankPrompt: "x".repeat(2001) })).toMatchObject({
        ok: false,
      });
      expect(validateConfig({ rerankPrompt: "rank stuff" })).toMatchObject({
        ok: true,
      });
    });

    it("rejects non-object inputs", () => {
      expect(validateConfig(null)).toMatchObject({ ok: false });
      expect(validateConfig("nope")).toMatchObject({ ok: false });
      expect(validateConfig(42)).toMatchObject({ ok: false });
    });

    it("accepts a multi-key valid update and returns the validated keys", () => {
      const result = validateConfig({ topK: 12, rerank: false });
      expect(result).toEqual({
        ok: true,
        value: { topK: 12, rerank: false },
      });
    });
  });

  it("setConfig writes through after validation passes", async () => {
    await setConfig({ rerankTopN: 5 });
    const fileContents = JSON.parse(readFileSync(tmpFile, "utf8"));
    expect(fileContents.rerankTopN).toBe(5);
  });

  it("setConfig creates the parent directory when missing", async () => {
    const nested = path.join(tmpDir, "nested", "deeper", "config.json");
    setConfigFilePath(nested);
    reloadConfigFromDisk();
    await setConfig({ topK: 3 });
    expect(existsSync(nested)).toBe(true);
  });
});
