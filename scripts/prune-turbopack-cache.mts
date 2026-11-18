#!/usr/bin/env node
/**
 * Caps each app's Turbopack cache from its working directory.
 *
 * Dev maintenance is best effort and never blocks startup. `--build` selects
 * `.next/cache`, preserves its mounted root, and fails on maintenance errors;
 * run it only between compiler processes. Oversized state is discarded so the
 * next compiler starts cold. Child symlinks are neither counted nor followed.
 *
 * Build maintenance uses Node's bounded directory iterator and stops counting
 * above the cap. Dev commands keep Bun and its existing best-effort behavior.
 *
 * CI build maintenance runs with Node 24: `node scripts/prune-turbopack-cache.mts [--build] [--force] [--dry-run]`.
 * `SIM_TURBOPACK_CACHE_MAX_GB` overrides the default 20 GiB cap.
 */
import { existsSync, lstatSync, statSync } from 'node:fs'
import { opendir, rm, rmdir, stat } from 'node:fs/promises'
import path from 'node:path'

const DEFAULT_MAX_GB = 20
const BYTES_PER_GB = 1024 ** 3
const BUILD_CACHE = process.argv.includes('--build')

/**
 * Each app owns its cache under its working directory. Build maintenance selects
 * a separate root, so it cannot prune a live dev server's state.
 */
const CACHE_DIR = path.resolve(
  process.cwd(),
  BUILD_CACHE ? '.next/cache' : '.next/dev/cache/turbopack'
)

function isMissingPath(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

/** Counts regular files without following symlinks or retaining the tree in memory. */
async function directorySize(dir: string, limit: number): Promise<number> {
  let total = 0
  let entries: Awaited<ReturnType<typeof opendir>>
  try {
    entries = await opendir(dir, { bufferSize: 32 })
  } catch (error) {
    if (BUILD_CACHE && isMissingPath(error)) return 0
    throw error
  }
  for await (const entry of entries) {
    const entryPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      total += await directorySize(entryPath, limit - total)
    } else if (entry.isFile()) {
      try {
        total += (await stat(entryPath)).size
      } catch (error) {
        if (BUILD_CACHE && !isMissingPath(error)) throw error
      }
    }
    if (total > limit) break
  }
  return total
}

async function clearDirectory(dir: string): Promise<void> {
  for await (const entry of await opendir(dir, { bufferSize: 32 })) {
    const entryPath = path.join(dir, entry.name)
    try {
      if (entry.isDirectory()) {
        await clearDirectory(entryPath)
        await rmdir(entryPath)
      } else {
        await rm(entryPath, { force: true })
      }
    } catch (error) {
      if (!isMissingPath(error)) throw error
    }
  }
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

  if (BUILD_CACHE) {
    let root: ReturnType<typeof lstatSync>
    try {
      root = lstatSync(CACHE_DIR)
    } catch (error) {
      if (isMissingPath(error)) return
      throw error
    }
    if (root.isSymbolicLink() || !root.isDirectory())
      throw new Error('Build cache root must be a directory without symlinks')
  } else if (!existsSync(CACHE_DIR) || !statSync(CACHE_DIR).isDirectory()) {
    return
  }

  const maxGb = parseMaxGb()
  const limit = BUILD_CACHE ? maxGb * BYTES_PER_GB : Number.POSITIVE_INFINITY
  const bytes = force ? 0 : await directorySize(CACHE_DIR, limit)
  const gb = bytes / BYTES_PER_GB
  const sizeLabel = force
    ? 'cache'
    : `${BUILD_CACHE && bytes > limit ? 'at least ' : ''}${gb.toFixed(1)} GB`

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
  if (!BUILD_CACHE && lstatSync(CACHE_DIR).isSymbolicLink()) {
    await rm(CACHE_DIR, { force: true })
    return
  }
  await clearDirectory(CACHE_DIR)
  if (!BUILD_CACHE) await rmdir(CACHE_DIR)
}

main().catch((error) => {
  console.warn('[turbopack-cache] prune skipped:', error)
  if (BUILD_CACHE) process.exitCode = 1
})
