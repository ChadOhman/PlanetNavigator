// Map tile slicer for PlanetNavigator.
//
// Slices the source planet map images in assets/source-maps/ into an XYZ
// tile pyramid consumable by OpenLayers (origin at top-left = [minX, maxZ]).
//
// Usage:
//   node --experimental-strip-types slice.ts [--planet <id>[,<id>...]] [--variant <v>]
//     [--format webp|png] [--out <dir>] [--force] [--max-zoom <n>]
//
// Run via `npm run tiles` from the repo root (invokes `npm run slice -w tools/tile-slicer`).

import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SOURCE_MAPS_DIR = path.join(REPO_ROOT, 'assets', 'source-maps');
const PLANETS_JSON_PATH = path.join(__dirname, 'planets.json');
const DEFAULT_OUT_DIR = path.join(REPO_ROOT, 'app', 'public', 'tiles');
const TILE_SIZE = 256;

type PlanetsConfig = Record<
  string,
  {
    extent: [number, number, number, number];
    variants: Record<string, string>;
  }
>;

type OutputFormat = 'webp' | 'png';

interface Cli {
  planets: string[] | null; // null = all
  variant: string | null; // null = all variants for selected planets
  format: OutputFormat;
  outDir: string;
  force: boolean;
  maxZoomOverride: number | null;
}

function parseArgs(argv: string[]): Cli {
  const cli: Cli = {
    planets: null,
    variant: null,
    format: 'webp',
    outDir: DEFAULT_OUT_DIR,
    force: false,
    maxZoomOverride: null,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--planet': {
        const value = argv[++i];
        if (!value) throw new Error('--planet requires a value');
        const list = value.split(',').map((s) => s.trim()).filter(Boolean);
        cli.planets = cli.planets ? [...cli.planets, ...list] : list;
        break;
      }
      case '--variant': {
        const value = argv[++i];
        if (!value) throw new Error('--variant requires a value');
        cli.variant = value.trim();
        break;
      }
      case '--format': {
        const value = argv[++i];
        if (value !== 'webp' && value !== 'png') {
          throw new Error(`--format must be "webp" or "png", got "${value}"`);
        }
        cli.format = value;
        break;
      }
      case '--out': {
        const value = argv[++i];
        if (!value) throw new Error('--out requires a value');
        cli.outDir = path.isAbsolute(value) ? value : path.resolve(process.cwd(), value);
        break;
      }
      case '--force':
        cli.force = true;
        break;
      case '--max-zoom': {
        const value = argv[++i];
        if (!value) throw new Error('--max-zoom requires a value');
        const n = Number.parseInt(value, 10);
        if (!Number.isFinite(n) || n < 0) throw new Error(`--max-zoom must be a non-negative integer, got "${value}"`);
        cli.maxZoomOverride = n;
        break;
      }
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return cli;
}

/** Tiny promise pool to bound concurrency. */
async function runPool<T>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<void>): Promise<void> {
  let cursor = 0;
  const runners: Promise<void>[] = [];
  const runNext = async (): Promise<void> => {
    while (cursor < items.length) {
      const index = cursor++;
      await worker(items[index], index);
    }
  };
  for (let i = 0; i < Math.min(concurrency, items.length); i++) {
    runners.push(runNext());
  }
  await Promise.all(runners);
}

async function dirSizeBytes(dir: string): Promise<number> {
  let total = 0;
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += await dirSizeBytes(full);
    } else if (entry.isFile()) {
      const stat = await fs.stat(full);
      total += stat.size;
    }
  }
  return total;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

interface ManifestV {
  planet: string;
  variant: string;
  tileSize: number;
  maxZoom: number;
  extent: [number, number, number, number];
  format: OutputFormat;
  sourceImage: string;
  sourceWidth: number;
  sourceHeight: number;
  generatedAt: string;
}

interface SliceResult {
  planet: string;
  variant: string;
  maxZoom: number;
  tileCount: number;
  elapsedMs: number;
  outputBytes: number;
  skipped: boolean;
}

async function sliceVariant(
  planet: string,
  variant: string,
  sourceFile: string,
  extent: [number, number, number, number],
  cli: Cli,
): Promise<SliceResult> {
  const start = Date.now();
  const sourcePath = path.join(SOURCE_MAPS_DIR, sourceFile);
  if (!existsSync(sourcePath)) {
    throw new Error(`Source image not found: ${sourcePath}`);
  }

  const variantOutDir = path.join(cli.outDir, planet, variant);
  const manifestPath = path.join(variantOutDir, 'manifest.json');

  const sourceStat = await fs.stat(sourcePath);

  // Skip if manifest exists, is newer than source, and --force wasn't passed.
  if (!cli.force && (await fileExists(manifestPath))) {
    const manifestStat = await fs.stat(manifestPath);
    if (manifestStat.mtimeMs >= sourceStat.mtimeMs) {
      const tileCount = await countExistingTiles(variantOutDir);
      const outputBytes = await dirSizeBytes(variantOutDir);
      console.log(
        `  [skip] ${planet}/${variant}: manifest up to date (use --force to regenerate)`,
      );
      return {
        planet,
        variant,
        maxZoom: -1,
        tileCount,
        elapsedMs: Date.now() - start,
        outputBytes,
        skipped: true,
      };
    }
  }

  const image = sharp(sourcePath);
  const metadata = await image.metadata();
  const width = metadata.width;
  const height = metadata.height;
  if (!width || !height) {
    throw new Error(`Could not read dimensions for ${sourcePath}`);
  }

  const computedMaxZoom = Math.ceil(Math.log2(Math.max(width, height) / TILE_SIZE));
  const maxZoom = cli.maxZoomOverride ?? Math.max(0, computedMaxZoom);
  const S = TILE_SIZE * 2 ** maxZoom;

  // Square-pad the source to S x S, anchored top-left, transparent background.
  const paddedBuffer = await sharp(sourcePath)
    .resize(S, S, {
      fit: 'contain',
      position: 'left top',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      kernel: 'lanczos3',
    })
    .ensureAlpha()
    .png()
    .toBuffer();

  await fs.rm(variantOutDir, { recursive: true, force: true });
  await fs.mkdir(variantOutDir, { recursive: true });

  const ext = cli.format;
  let tileCount = 0;

  for (let z = 0; z <= maxZoom; z++) {
    const levelSize = TILE_SIZE * 2 ** z;
    const levelBuffer = await sharp(paddedBuffer)
      .resize(levelSize, levelSize, {
        fit: 'fill',
        kernel: 'lanczos3',
      })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const tilesAcross = 2 ** z;
    const jobs: Array<{ x: number; y: number }> = [];
    for (let y = 0; y < tilesAcross; y++) {
      for (let x = 0; x < tilesAcross; x++) {
        jobs.push({ x, y });
      }
    }

    const levelDirBase = path.join(variantOutDir, String(z));

    await runPool(jobs, 8, async ({ x, y }) => {
      const tileDir = path.join(levelDirBase, String(x));
      await fs.mkdir(tileDir, { recursive: true });
      const tilePath = path.join(tileDir, `${y}.${ext}`);

      let pipeline = sharp(levelBuffer.data, {
        raw: {
          width: levelBuffer.info.width,
          height: levelBuffer.info.height,
          channels: levelBuffer.info.channels as 1 | 2 | 3 | 4,
        },
      }).extract({
        left: x * TILE_SIZE,
        top: y * TILE_SIZE,
        width: TILE_SIZE,
        height: TILE_SIZE,
      });

      pipeline = ext === 'webp' ? pipeline.webp({ quality: 90 }) : pipeline.png();

      await pipeline.toFile(tilePath);
      tileCount++;
    });
  }

  const manifest: ManifestV = {
    planet,
    variant,
    tileSize: TILE_SIZE,
    maxZoom,
    extent,
    format: cli.format,
    sourceImage: sourceFile,
    sourceWidth: width,
    sourceHeight: height,
    generatedAt: new Date().toISOString(),
  };
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');

  const outputBytes = await dirSizeBytes(variantOutDir);
  const elapsedMs = Date.now() - start;

  console.log(
    `  [done] ${planet}/${variant}: maxZoom=${maxZoom} tiles=${tileCount} elapsed=${elapsedMs}ms size=${(outputBytes / 1024 / 1024).toFixed(2)}MB`,
  );

  return { planet, variant, maxZoom, tileCount, elapsedMs, outputBytes, skipped: false };
}

async function countExistingTiles(variantOutDir: string): Promise<number> {
  let count = 0;
  async function walk(dir: string): Promise<void> {
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && /\.(webp|png)$/i.test(entry.name)) {
        count++;
      }
    }
  }
  await walk(variantOutDir);
  return count;
}

interface IndexJson {
  generatedAt: string;
  planets: Record<
    string,
    {
      extent: [number, number, number, number];
      variants: Record<string, { maxZoom: number; format: OutputFormat }>;
    }
  >;
}

async function writeIndex(cli: Cli, planetsConfig: PlanetsConfig, results: SliceResult[]): Promise<void> {
  const indexPath = path.join(cli.outDir, 'index.json');

  let existing: IndexJson = { generatedAt: new Date().toISOString(), planets: {} };
  if (await fileExists(indexPath)) {
    try {
      const raw = await fs.readFile(indexPath, 'utf-8');
      existing = JSON.parse(raw) as IndexJson;
    } catch {
      // ignore malformed existing index; we'll overwrite it
    }
  }

  const merged: IndexJson = {
    generatedAt: new Date().toISOString(),
    planets: { ...existing.planets },
  };

  // Re-derive entries for every planet/variant that now has a manifest on disk
  // (covers both freshly-sliced and previously-skipped variants), scoped to
  // the planets touched in this run.
  const touchedPlanets = new Set(results.map((r) => r.planet));
  for (const planet of touchedPlanets) {
    const planetConfig = planetsConfig[planet];
    if (!planetConfig) continue;
    const variantsOut: Record<string, { maxZoom: number; format: OutputFormat }> = {
      ...(merged.planets[planet]?.variants ?? {}),
    };
    for (const variant of Object.keys(planetConfig.variants)) {
      const manifestPath = path.join(cli.outDir, planet, variant, 'manifest.json');
      if (await fileExists(manifestPath)) {
        const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf-8')) as ManifestV;
        variantsOut[variant] = { maxZoom: manifest.maxZoom, format: manifest.format };
      }
    }
    merged.planets[planet] = { extent: planetConfig.extent, variants: variantsOut };
  }

  await fs.mkdir(cli.outDir, { recursive: true });
  await fs.writeFile(indexPath, JSON.stringify(merged, null, 2) + '\n', 'utf-8');
}

async function writeAttribution(cli: Cli): Promise<void> {
  const licenseSrc = path.join(SOURCE_MAPS_DIR, 'LICENSE-APACHE-2.0');
  const licenseDest = path.join(cli.outDir, 'LICENSE-APACHE-2.0');
  await fs.mkdir(cli.outDir, { recursive: true });
  await fs.copyFile(licenseSrc, licenseDest);

  const commitShaRaw = await fs.readFile(path.join(SOURCE_MAPS_DIR, 'SOURCE_COMMIT.txt'), 'utf-8');
  const commitSha = commitShaRaw.trim();

  const attribution =
    `Map tile imagery in this directory is derived from source images published in the ` +
    `akarnokd/ThePlanetCrafterMods repository (CheatMinimap/images), at commit ${commitSha}, ` +
    `licensed under the Apache License 2.0 (see LICENSE-APACHE-2.0 in this directory). ` +
    `The Planet Crafter and its assets are the property of their respective owner, Miju Games; ` +
    `this tool and PlanetNavigator are not affiliated with or endorsed by Miju Games.\n`;

  await fs.writeFile(path.join(cli.outDir, 'ATTRIBUTION.txt'), attribution, 'utf-8');
}

async function main(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2));

  const planetsConfig = JSON.parse(await fs.readFile(PLANETS_JSON_PATH, 'utf-8')) as PlanetsConfig;

  const planetIds = cli.planets ?? Object.keys(planetsConfig);
  for (const id of planetIds) {
    if (!planetsConfig[id]) {
      throw new Error(`Unknown planet "${id}". Known planets: ${Object.keys(planetsConfig).join(', ')}`);
    }
  }

  const jobs: Array<{ planet: string; variant: string; file: string; extent: [number, number, number, number] }> = [];
  for (const planet of planetIds) {
    const config = planetsConfig[planet];
    const variantIds = cli.variant ? [cli.variant] : Object.keys(config.variants);
    for (const variant of variantIds) {
      const file = config.variants[variant];
      if (!file) {
        throw new Error(`Planet "${planet}" has no variant "${variant}". Known variants: ${Object.keys(config.variants).join(', ')}`);
      }
      jobs.push({ planet, variant, file, extent: config.extent });
    }
  }

  console.log(`Slicing ${jobs.length} planet/variant combination(s) -> ${cli.outDir}`);
  console.log(`Format: ${cli.format}${cli.maxZoomOverride !== null ? `, maxZoom override: ${cli.maxZoomOverride}` : ''}${cli.force ? ', force: true' : ''}`);

  const results: SliceResult[] = [];
  const failures: Array<{ job: (typeof jobs)[number]; error: unknown }> = [];

  for (const job of jobs) {
    console.log(`\n${job.planet}/${job.variant} (${job.file})`);
    try {
      const result = await sliceVariant(job.planet, job.variant, job.file, job.extent, cli);
      results.push(result);
    } catch (error) {
      console.error(`  [fail] ${job.planet}/${job.variant}: ${(error as Error).message}`);
      failures.push({ job, error });
    }
  }

  if (results.length > 0) {
    await writeIndex(cli, planetsConfig, results);
  }
  await writeAttribution(cli);

  console.log('\n--- Summary ---');
  let grandTotalBytes = 0;
  for (const r of results) {
    grandTotalBytes += r.outputBytes;
    const label = r.skipped ? 'skipped (up to date)' : `maxZoom=${r.maxZoom} tiles=${r.tileCount} elapsed=${r.elapsedMs}ms`;
    console.log(`${r.planet}/${r.variant}: ${label} size=${(r.outputBytes / 1024 / 1024).toFixed(2)}MB`);
  }
  console.log(`Total output size: ${(grandTotalBytes / 1024 / 1024).toFixed(2)}MB`);

  if (failures.length > 0) {
    console.error(`\n${failures.length} job(s) failed:`);
    for (const f of failures) {
      console.error(`  - ${f.job.planet}/${f.job.variant}: ${(f.error as Error).message}`);
    }
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exitCode = 1;
});
