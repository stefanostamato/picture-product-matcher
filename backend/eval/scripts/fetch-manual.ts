import { mkdir, writeFile, access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Downloads a small (~10) curated subset of permissively-licensed real-world
// interior/furniture photos for human eyeballing during eval. Not scored.
//
// `MANUAL_ENTRIES` below is a curated list of Unsplash-License photos with
// verified direct image URLs and photographer names. To swap an entry, copy
// the direct image URL from a photo's page (the `images.unsplash.com/photo-`
// URL exposed by the "Download free" button) and confirm the license is one
// of: "Unsplash License", "Pexels License", "CC0". Drop any entry you are
// unsure about — do not guess.
//
// The script is idempotent: existing JPEGs are preserved on re-run.
// `ATTRIBUTION.md` is always rewritten so it stays in sync with the list.

export interface ManualEntry {
  /** Direct image URL (https). Replace placeholder before running the script. */
  url: string;
  photographer: string;
  source: string;
  /** Must be a permissive license string. See module-doc above. */
  license: "Unsplash License" | "Pexels License" | "CC0";
}

// Curated set of Unsplash-License interior/furniture photos. Themes are
// spread across common rooms and furniture so the manual subset exercises a
// variety of pipeline inputs. URLs were verified to return HTTP 200 + JPEG
// content at the time of curation; if any 404 in the future, swap the entry
// rather than letting the script fail silently.
export const MANUAL_ENTRIES: ManualEntry[] = [
  {
    url: "https://images.unsplash.com/photo-1499955085172-a104c9463ece?w=1600&q=80&fm=jpg",
    photographer: "Hannah Busing",
    source: "Unsplash",
    license: "Unsplash License",
  },
  {
    url: "https://images.unsplash.com/photo-1655665151765-98a95126ba41?w=1600&q=80&fm=jpg",
    photographer: "Katie Wallace",
    source: "Unsplash",
    license: "Unsplash License",
  },
  {
    url: "https://images.unsplash.com/photo-1537726235470-8504e3beef77?w=1600&q=80&fm=jpg",
    photographer: "Roberto Nickson",
    source: "Unsplash",
    license: "Unsplash License",
  },
  {
    url: "https://images.unsplash.com/photo-1530334565651-210b286480b7?w=1600&q=80&fm=jpg",
    photographer: "CHUTTERSNAP",
    source: "Unsplash",
    license: "Unsplash License",
  },
  {
    url: "https://images.unsplash.com/photo-1464029902023-f42eba355bde?w=1600&q=80&fm=jpg",
    photographer: "Alexander Pemberton",
    source: "Unsplash",
    license: "Unsplash License",
  },
  {
    url: "https://images.unsplash.com/photo-1752495673039-266817682031?w=1600&q=80&fm=jpg",
    photographer: "David Kristianto",
    source: "Unsplash",
    license: "Unsplash License",
  },
  {
    url: "https://images.unsplash.com/photo-1682888813788-bf57c360123e?w=1600&q=80&fm=jpg",
    photographer: "Zac Gudakov",
    source: "Unsplash",
    license: "Unsplash License",
  },
  {
    url: "https://images.unsplash.com/photo-1741509541812-5d8f3e96df23?w=1600&q=80&fm=jpg",
    photographer: "Martin Katler",
    source: "Unsplash",
    license: "Unsplash License",
  },
  {
    url: "https://images.unsplash.com/photo-1494438639946-1ebd1d20bf85?w=1600&q=80&fm=jpg",
    photographer: "David van Dijk",
    source: "Unsplash",
    license: "Unsplash License",
  },
  {
    url: "https://images.unsplash.com/photo-1553444862-65de13a9e728?w=1600&q=80&fm=jpg",
    photographer: "Filios Sazeides",
    source: "Unsplash",
    license: "Unsplash License",
  },
];

export interface FetchManualOptions {
  entries: readonly ManualEntry[];
  outDir: string;
}

export interface FetchManualResult {
  written: number;
  skipped: number;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export function buildAttributionMarkdown(entries: readonly ManualEntry[]): string {
  const lines: string[] = [];
  lines.push("# Manual eval fixtures — attribution");
  lines.push("");
  lines.push(
    "Real-world interior/furniture photos used for human eyeballing during",
  );
  lines.push(
    "eval runs. Not scored. Each file below ships under its listed license.",
  );
  lines.push("");
  lines.push("| File | Photographer | Source | License | URL |");
  lines.push("| --- | --- | --- | --- | --- |");
  entries.forEach((entry, i) => {
    const file = `${i + 1}.jpg`;
    lines.push(
      `| ${file} | ${entry.photographer} | ${entry.source} | ${entry.license} | ${entry.url} |`,
    );
  });
  lines.push("");
  return lines.join("\n");
}

export async function fetchManualFixtures(
  options: FetchManualOptions,
): Promise<FetchManualResult> {
  await mkdir(options.outDir, { recursive: true });

  let written = 0;
  let skipped = 0;

  for (let i = 0; i < options.entries.length; i++) {
    const entry = options.entries[i];
    const outPath = resolve(options.outDir, `${i + 1}.jpg`);

    if (await fileExists(outPath)) {
      skipped++;
      continue;
    }

    const response = await fetch(entry.url);
    if (!response.ok) {
      throw new Error(
        `fetch-manual: ${entry.url} returned HTTP ${response.status}`,
      );
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    await writeFile(outPath, buffer);
    written++;
  }

  const md = buildAttributionMarkdown(options.entries);
  await writeFile(resolve(options.outDir, "ATTRIBUTION.md"), md, "utf8");

  return { written, skipped };
}

// ---------- CLI entry ----------

async function main(): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  const outDir = resolve(here, "..", "fixtures", "manual");

  const placeholders = MANUAL_ENTRIES.filter((e) => e.url.startsWith("REPLACE_ME_"));
  if (placeholders.length > 0) {
    throw new Error(
      [
        `fetch-manual: ${placeholders.length} entries still have REPLACE_ME_* placeholder URLs.`,
        `Edit backend/eval/scripts/fetch-manual.ts and replace each placeholder with a real`,
        `direct image URL from a permissively-licensed source (Unsplash / Pexels / CC0).`,
        `Then re-run 'npm run manual:fetch'.`,
      ].join(" "),
    );
  }

  const result = await fetchManualFixtures({
    entries: MANUAL_ENTRIES,
    outDir,
  });

  // eslint-disable-next-line no-console
  console.log(
    `Done. Wrote ${result.written} new JPEGs, skipped ${result.skipped} already-present. Refreshed ATTRIBUTION.md.`,
  );
}

const isDirectRun =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("fetch-manual.ts");

if (isDirectRun) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
