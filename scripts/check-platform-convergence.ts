#!/usr/bin/env bun
/**
 * Keeps `apps/sim/platform/embedded` (the organization views) and the Platform zone converging. The
 * two trees exist because their markup differs; anything else belongs once, in `platform/shared`.
 *
 * - `embedded-files`: the number of files under `platform/embedded` may only fall. A new module goes
 *   in `platform/shared` or replaces one that leaves.
 * - `shared-path`: a file at the same relative path under `platform/{app,lib}` and
 *   `platform/embedded/{app,lib}` is a parallel implementation until proven otherwise. A new pair
 *   fails, however different the two files look today.
 *
 * Existing state is recorded in `scripts/check-platform-convergence.baseline.json`. Growth fails, and
 * so does a baseline that claims more than the trees hold, so it only ever shrinks. Regenerate it
 * after converging a domain with `bun run scripts/check-platform-convergence.ts --update`, which
 * refuses growth. The recipe is in `apps/sim/platform/AGENTS.md`.
 *
 * Run: `bun run check:platform-convergence`
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dirname, '..')
const PLATFORM = path.join(ROOT, 'apps/sim/platform')
const BASELINE = path.join(ROOT, 'scripts/check-platform-convergence.baseline.json')
const TREES = ['app', 'lib']

export interface ConvergenceState {
  embeddedFiles: number
  sharedPaths: string[]
}

/** Paths both trees hold, in code-unit order so the baseline never reorders between machines. */
export function findSharedPaths(zone: readonly string[], embedded: readonly string[]): string[] {
  const zoneFiles = new Set(zone)
  return embedded.filter((file) => zoneFiles.has(file)).sort()
}

/** `grew` is new debt, to fix in the code; `stale` is paid-off debt, to take out of the baseline. */
export function evaluateConvergence(current: ConvergenceState, baseline: ConvergenceState) {
  const grew: string[] = []
  const stale: string[] = []
  if (current.embeddedFiles > baseline.embeddedFiles) {
    grew.push(
      `platform/embedded holds ${current.embeddedFiles} files (baseline ${baseline.embeddedFiles})`
    )
  } else if (current.embeddedFiles < baseline.embeddedFiles) {
    stale.push(
      `platform/embedded holds ${current.embeddedFiles} files (baseline ${baseline.embeddedFiles})`
    )
  }
  const recorded = new Set(baseline.sharedPaths)
  const held = new Set(current.sharedPaths)
  for (const file of current.sharedPaths) {
    if (!recorded.has(file)) grew.push(`both trees hold ${file}`)
  }
  for (const file of baseline.sharedPaths) {
    if (!held.has(file)) stale.push(`no longer in both trees: ${file}`)
  }
  return { grew, stale }
}

function filesUnder(directory: string): string[] {
  if (!existsSync(directory)) return []
  return readdirSync(directory, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(directory, path.join(entry.parentPath, entry.name)))
}

function treeFiles(root: string): string[] {
  return TREES.flatMap((tree) =>
    filesUnder(path.join(root, tree)).map((file) => path.join(tree, file))
  )
}

function readCurrent(): ConvergenceState {
  return {
    embeddedFiles: filesUnder(path.join(PLATFORM, 'embedded')).length,
    sharedPaths: findSharedPaths(treeFiles(PLATFORM), treeFiles(path.join(PLATFORM, 'embedded'))),
  }
}

function report(lines: readonly string[]) {
  for (const line of lines) console.error(`  ${line}`)
}

if (import.meta.main) {
  const current = readCurrent()
  if (!existsSync(BASELINE)) {
    console.error(`${path.relative(ROOT, BASELINE)} is missing. Restore it from git.`)
    process.exit(1)
  }
  const baseline: ConvergenceState = JSON.parse(readFileSync(BASELINE, 'utf8'))
  const { grew, stale } = evaluateConvergence(current, baseline)
  if (grew.length > 0) {
    console.error('✗ The zone and the organization views grew apart:')
    report(grew)
    console.error(
      'Move the shared part to platform/shared and inject what differs; never add to the baseline.'
    )
    process.exit(1)
  }
  if (process.argv.includes('--update')) {
    writeFileSync(BASELINE, `${JSON.stringify(current, null, 2)}\n`)
    console.log(`Wrote ${path.relative(ROOT, BASELINE)}`)
    process.exit(0)
  }
  if (stale.length > 0) {
    console.error('✗ Converged further than the baseline says; shrink it with --update:')
    report(stale)
    process.exit(1)
  }
  console.log(
    `✓ platform convergence (${current.embeddedFiles} embedded files, ${current.sharedPaths.length} paths in both trees)`
  )
}
