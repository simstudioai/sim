#!/usr/bin/env node
/**
 * Caps an app's Turbopack dev cache (`.next/dev/cache/turbopack`) from its working directory.
 *
 * Best effort: it never blocks `next dev` startup. Oversized state is discarded so the next start
 * compiles cold. Child symlinks are neither counted nor followed; a symlinked cache root is unlinked
 * without touching its target.
 *
 * Usage: `bun run scripts/prune-turbopack-cache.mts [--force] [--dry-run]`.
 * `SIM_TURBOPACK_CACHE_MAX_GB` overrides the default 20 GiB cap.
 */
import { existsSync, lstatSync, statSync } from 'node:fs'
import { opendir, rm, rmdir, stat } from 'node:fs/promises'
import path from 'node:path'

const DEFAULT_MAX_GB = 20
const BYTES_PER_GB = 1024 ** 3

/** Each app owns its dev cache under its working directory. */
const CACHE_DIR = path.resolve(process.cwd(), '.next/dev/cache/turbopack')

function isMissingPath(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

/** Counts regular files without following symlinks or retaining the tree in memory. */
async function directorySize(dir: string): Promise<number> {
  let total = 0
  for await (const entry of await opendir(dir, { bufferSize: 32 })) {
    const entryPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      total += await directorySize(entryPath)
    } else if (entry.isFile()) {
      try {
        total += (await stat(entryPath)).size
      } catch {}
    }
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
  if (!existsSync(CACHE_DIR) || !statSync(CACHE_DIR).isDirectory()) return

  const maxGb = parseMaxGb()
  const gb = force ? 0 : (await directorySize(CACHE_DIR)) / BYTES_PER_GB
  const sizeLabel = force ? 'cache' : `${gb.toFixed(1)} GB`

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
  if (lstatSync(CACHE_DIR).isSymbolicLink()) {
    await rm(CACHE_DIR, { force: true })
    return
  }
  await clearDirectory(CACHE_DIR)
  await rmdir(CACHE_DIR)
}

main().catch((error) => {
  console.warn('[turbopack-cache] prune skipped:', error)
})
