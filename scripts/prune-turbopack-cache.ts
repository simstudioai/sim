#!/usr/bin/env bun
/**
 * Caps the size of Turbopack's dev filesystem cache.
 *
 * `experimental.turbopackFileSystemCacheForDev` is ON (see `apps/sim/next.config.ts`)
 * because it makes dev-server restarts 5.4x faster and cuts RSS ~1.9x. The tradeoff
 * is that the cache is an append-heavy LSM store with no upstream GC: it grows with
 * every route compiled and every code change, and it is never pruned. An abandoned
 * cache in this repo reached 78 GB across 1,848 SST files.
 *
 * A stale cache is also slower to read back, so an unbounded one eventually erodes
 * the win it exists to provide. This script drops the whole cache once it crosses a
 * threshold; Turbopack rebuilds it on the next run (one cold compile, ~32s).
 *
 * Also the remedy when Turbopack aborts with `Cache corruption detected:
 * checksum mismatch` — it does not self-heal from a corrupted cache, so prune
 * and restart. (An ordinary hard kill does not corrupt it; Turbopack discards a
 * partial write and rebuilds silently.)
 *
 * Runs automatically before every `dev` script. Also invokable directly:
 *   bun run scripts/prune-turbopack-cache.ts            # prune if over the cap
 *   bun run scripts/prune-turbopack-cache.ts --force    # always prune
 *   bun run scripts/prune-turbopack-cache.ts --dry-run  # report only
 *
 * Override the cap with `SIM_TURBOPACK_CACHE_MAX_GB` (default 20).
 *
 * The cap is a backstop, not routine maintenance. A normal session's cache sits
 * around 1-2 GB; the 78 GB case was a month of accumulation while the feature was
 * effectively abandoned. Measured cost of the size walk: ~30ms on a real cache,
 * ~85ms at 2,000 files — under 2% of a warm restart.
 *
 * Safe to run while a dev server is live, which happens if a second server is
 * started from the same checkout: the running server keeps its in-memory state
 * and continues serving (verified — no crash, no corruption). It does stop
 * persisting for the rest of that session, so its *next* start is cold once, then
 * back to normal. Nothing to clean up.
 *
 * Note for anyone benchmarking the cache: stop the dev server with SIGINT, not
 * `kill -9`. Turbopack discards a partially-written cache and rebuilds silently,
 * so a hard kill makes a real cache win read as no win at all.
 */
import { existsSync, statSync } from 'node:fs'
import { readdir, rm, stat } from 'node:fs/promises'
import path from 'node:path'

const DEFAULT_MAX_GB = 20
const BYTES_PER_GB = 1024 ** 3

/**
 * Resolved from the working directory, not hardcoded to one app: every Next app
 * in the monorepo has its own dev cache (`apps/docs` runs `next dev` too and, with
 * no override, uses the Next default where the cache is on). Each app caps its
 * own, so one app's dev start never prunes a cache another app is holding open.
 */
const CACHE_DIR = path.resolve(process.cwd(), '.next', 'dev', 'cache', 'turbopack')

/** Sums the size of every regular file under `dir`, skipping symlinks. */
async function directorySize(dir: string): Promise<number> {
  let total = 0
  const entries = await readdir(dir, { withFileTypes: true, recursive: true })
  for (const entry of entries) {
    if (!entry.isFile()) continue
    try {
      total += (await stat(path.join(entry.parentPath, entry.name))).size
    } catch {
      // Turbopack compacts while we walk; a file vanishing mid-scan is expected.
    }
  }
  return total
}

function parseMaxGb(): number {
  const raw = process.env.SIM_TURBOPACK_CACHE_MAX_GB
  if (!raw) return DEFAULT_MAX_GB
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.warn(
      `[turbopack-cache] ignoring invalid SIM_TURBOPACK_CACHE_MAX_GB=${raw}, using ${DEFAULT_MAX_GB}`
    )
    return DEFAULT_MAX_GB
  }
  return parsed
}

async function main() {
  const force = process.argv.includes('--force')
  const dryRun = process.argv.includes('--dry-run')

  if (!existsSync(CACHE_DIR) || !statSync(CACHE_DIR).isDirectory()) return

  const maxGb = parseMaxGb()
  const bytes = await directorySize(CACHE_DIR)
  const gb = bytes / BYTES_PER_GB
  const sizeLabel = `${gb.toFixed(1)} GB`

  if (!force && gb <= maxGb) {
    if (dryRun) console.log(`[turbopack-cache] ${sizeLabel} (cap ${maxGb} GB) — keeping`)
    return
  }

  const reason = force ? 'forced' : `over the ${maxGb} GB cap`
  if (dryRun) {
    console.log(`[turbopack-cache] ${sizeLabel} is ${reason} — would prune (dry run)`)
    return
  }

  console.log(`[turbopack-cache] ${sizeLabel} is ${reason} — pruning; next start recompiles cold`)
  await rm(CACHE_DIR, { recursive: true, force: true })
}

main().catch((error) => {
  // Never block `next dev` on a cache-maintenance failure.
  console.warn('[turbopack-cache] prune skipped:', error)
})
