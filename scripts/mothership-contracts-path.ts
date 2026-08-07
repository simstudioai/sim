import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(SCRIPT_DIR, '..')

/**
 * Sibling checkout layouts we look for, in order. The Go service lives at
 * `<repo>/copilot`, so the contracts directory is always `<repo>/copilot/contracts`
 * — only the repo directory name differs between clones (`copilot` vs
 * `mothership`).
 */
const CANDIDATE_REPO_DIRS = ['../copilot', '../mothership'] as const

/**
 * Resolves a generated mothership contract file.
 *
 * Every `sync-*-contract` script used to hardcode `../copilot/copilot/contracts/…`,
 * which silently fails on a clone checked out as `mothership/` — the whole
 * `bun run mship:generate` pipeline then reports a missing file with no hint
 * that the path assumption, not the contract, is what's wrong. Probing both
 * layouts (and honoring an explicit override) keeps a fresh clone working
 * regardless of what the directory happens to be called.
 *
 * Precedence: `--input=` on the command line (handled by each caller) >
 * `MOTHERSHIP_REPO` env var > the probed sibling layouts.
 *
 * @param fileName Contract file name, e.g. `vfs-snapshot-v1.schema.json`.
 */
export function resolveMothershipContract(fileName: string): string {
  const override = process.env.MOTHERSHIP_REPO
  if (override) {
    return resolve(ROOT, override, 'copilot/contracts', fileName)
  }

  const tried: string[] = []
  for (const repoDir of CANDIDATE_REPO_DIRS) {
    const candidate = resolve(ROOT, repoDir, 'copilot/contracts', fileName)
    if (existsSync(candidate)) return candidate
    tried.push(candidate)
  }

  // Returning the first candidate keeps the caller's own "file not found" error
  // as the failure mode, with the tried paths named so the fix is obvious.
  throw new Error(
    `Could not find mothership contract "${fileName}". Tried:\n  ${tried.join('\n  ')}\n` +
      'Set MOTHERSHIP_REPO (relative to the sim repo root, e.g. MOTHERSHIP_REPO=../mothership) ' +
      'or pass --input=<path>.'
  )
}
