import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  fetchManualFixtures,
  buildAttributionMarkdown,
  MANUAL_ENTRIES,
  type ManualEntry,
} from "./fetch-manual.js";

const ENTRIES: ManualEntry[] = [
  {
    url: "https://example.test/a.jpg",
    photographer: "Photographer A",
    source: "Unsplash",
    license: "Unsplash License",
  },
  {
    url: "https://example.test/b.jpg",
    photographer: "Photographer B",
    source: "Pexels",
    license: "Pexels License",
  },
];

function jpegResponse(body: string): Response {
  return new Response(new TextEncoder().encode(body), {
    status: 200,
    headers: { "Content-Type": "image/jpeg" },
  });
}

describe("fetchManualFixtures", () => {
  const fetchMock = vi.fn();
  let outDir: string;

  beforeEach(async () => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    outDir = await mkdtemp(join(tmpdir(), "fetch-manual-"));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("downloads each entry exactly once and writes <index>.jpg files", async () => {
    fetchMock
      .mockResolvedValueOnce(jpegResponse("payload-a"))
      .mockResolvedValueOnce(jpegResponse("payload-b"));

    const result = await fetchManualFixtures({ entries: ENTRIES, outDir });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(1, ENTRIES[0].url);
    expect(fetchMock).toHaveBeenNthCalledWith(2, ENTRIES[1].url);

    const a = await readFile(join(outDir, "1.jpg"), "utf8");
    const b = await readFile(join(outDir, "2.jpg"), "utf8");
    expect(a).toBe("payload-a");
    expect(b).toBe("payload-b");

    expect(result.written).toBe(2);
    expect(result.skipped).toBe(0);
  });

  it("writes ATTRIBUTION.md generated from the entry list", async () => {
    fetchMock
      .mockResolvedValueOnce(jpegResponse("a"))
      .mockResolvedValueOnce(jpegResponse("b"));

    await fetchManualFixtures({ entries: ENTRIES, outDir });

    const md = await readFile(join(outDir, "ATTRIBUTION.md"), "utf8");
    expect(md).toContain("1.jpg");
    expect(md).toContain("Photographer A");
    expect(md).toContain("Unsplash License");
    expect(md).toContain("https://example.test/a.jpg");
    expect(md).toContain("2.jpg");
    expect(md).toContain("Photographer B");
    expect(md).toContain("Pexels License");
  });

  it("skips entries whose target file already exists (idempotent)", async () => {
    await mkdir(outDir, { recursive: true });
    await writeFile(join(outDir, "1.jpg"), "preexisting", "utf8");

    fetchMock.mockResolvedValueOnce(jpegResponse("payload-b"));

    const result = await fetchManualFixtures({ entries: ENTRIES, outDir });

    // Only the missing one is fetched.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(ENTRIES[1].url);

    const a = await readFile(join(outDir, "1.jpg"), "utf8");
    expect(a).toBe("preexisting"); // untouched

    const b = await readFile(join(outDir, "2.jpg"), "utf8");
    expect(b).toBe("payload-b");

    expect(result.written).toBe(1);
    expect(result.skipped).toBe(1);

    // ATTRIBUTION.md is still rewritten so it always reflects the full list.
    const md = await readFile(join(outDir, "ATTRIBUTION.md"), "utf8");
    expect(md).toContain("1.jpg");
    expect(md).toContain("2.jpg");
  });

  it("throws when the network response is not ok and does not write the file", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("nope", { status: 404 }),
    );

    await expect(
      fetchManualFixtures({ entries: [ENTRIES[0]], outDir }),
    ).rejects.toThrow();

    await expect(stat(join(outDir, "1.jpg"))).rejects.toThrow();
  });
});

describe("buildAttributionMarkdown", () => {
  it("renders one row per entry with file/photographer/source/license/url", () => {
    const md = buildAttributionMarkdown(ENTRIES);
    expect(md).toMatch(/^# /m);
    for (let i = 0; i < ENTRIES.length; i++) {
      const e = ENTRIES[i];
      expect(md).toContain(`${i + 1}.jpg`);
      expect(md).toContain(e.photographer);
      expect(md).toContain(e.source);
      expect(md).toContain(e.license);
      expect(md).toContain(e.url);
    }
  });
});

describe("MANUAL_ENTRIES (curated list)", () => {
  it("is non-empty and only references permissive licenses", () => {
    expect(MANUAL_ENTRIES.length).toBeGreaterThan(0);
    const allowed = new Set([
      "Unsplash License",
      "Pexels License",
      "CC0",
    ]);
    for (const e of MANUAL_ENTRIES) {
      expect(allowed.has(e.license)).toBe(true);
      expect(typeof e.url).toBe("string");
      expect(e.url.length).toBeGreaterThan(0);
      expect(typeof e.photographer).toBe("string");
      expect(typeof e.source).toBe("string");
    }
  });
});
