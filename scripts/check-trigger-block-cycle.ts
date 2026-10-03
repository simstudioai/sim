#!/usr/bin/env bun
/**
 * Fails if `@/triggers` can statically reach `@/blocks`.
 *
 * Block configs spread `getTrigger('…').subBlocks` while their module body runs, so
 * `blocks/*` legitimately depends on `triggers/*`. The reverse edge closes the loop, and
 * then whichever barrel an entry point reaches first decides whether the process starts:
 * enter through `@/triggers` and a block config calls `getTrigger()` before
 * `TRIGGER_REGISTRY` is initialized, throwing
 * `ReferenceError: Cannot access 'TRIGGER_REGISTRY' before initialization`.
 *
 * This regressed silently once already. `deploy.ts` imported a value from `@/blocks`,
 * which biome sorts above `@/triggers`, so the safe barrel always evaluated first. #6272
 * deleted that import as unused cleanup and took all eleven deployment routes with it —
 * a one-line deletion, forty lines from the import it was protecting, in a file whose
 * tests mock both barrels and therefore could not fail.
 *
 * Only STATIC edges are walked. A dynamic `import()` resolves when it is called rather
 * than during module evaluation, so it carries no initialization-order obligation — that
 * is precisely how `triggers/editor-state.ts` reads the editor's Zustand stores.
 *
 * Usage:
 *   bun run scripts/check-trigger-block-cycle.ts
 *   bun run scripts/check-trigger-block-cycle.ts --verbose   # print graph size
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(SCRIPT_DIR, '..')
const APP = join(ROOT, 'apps/sim')

/** Entry points that must never reach `blocks/`. Both are barrels an app module may import first. */
const ENTRIES = ['triggers/index.ts', 'triggers/registry.ts']

/** Directory the entries must not reach. */
const FORBIDDEN_DIR = join(APP, 'blocks')

const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs']

/**
 * Static value imports and re-exports only. `import type` / `export type` are erased at
 * compile time, so a type-only edge costs nothing at runtime and cannot affect ordering.
 */
const IMPORT_RE = /(?:^|\n)\s*import\s+(?!type\b)(?:[\s\S]*?from\s*)?['"]([^'"]+)['"]/g
const REEXPORT_RE =
  /(?:^|\n)\s*export\s+(?!type\b)(?:\*(?:\s+as\s+[\w$]+)?|\{[\s\S]*?\})\s*from\s*['"]([^'"]+)['"]/g

/** Resolves `@/` and relative specifiers. Bare package specifiers are ignored. */
function resolveSpecifier(specifier: string, importer: string): string | null {
  let base: string
  if (specifier.startsWith('@/')) base = join(APP, specifier.slice(2))
  else if (specifier.startsWith('.')) base = resolve(dirname(importer), specifier)
  else return null

  if (existsSync(base) && statSync(base).isFile()) return base
  for (const ext of EXTENSIONS) {
    if (existsSync(base + ext)) return base + ext
  }
  if (existsSync(base) && statSync(base).isDirectory()) {
    for (const ext of EXTENSIONS) {
      const indexPath = join(base, `index${ext}`)
      if (existsSync(indexPath)) return indexPath
    }
  }
  return null
}

/**
 * Breadth-first so the reported chain is the shortest one. A depth-first walk reports
 * whichever path it wandered down, which can be dozens of hops long and unreadable.
 */
function findPathToBlocks(entry: string): { path: string[]; visited: number } {
  const importedBy = new Map<string, string | null>([[entry, null]])
  const queue: string[] = [entry]

  while (queue.length > 0) {
    const file = queue.shift() as string
    if (file.startsWith(`${FORBIDDEN_DIR}/`) || file === `${FORBIDDEN_DIR}.ts`) {
      const chain: string[] = []
      let cursor: string | null = file
      while (cursor) {
        chain.unshift(relative(APP, cursor))
        cursor = importedBy.get(cursor) ?? null
      }
      return { path: chain, visited: importedBy.size }
    }

    let source: string
    try {
      source = readFileSync(file, 'utf8')
    } catch {
      continue
    }

    for (const pattern of [IMPORT_RE, REEXPORT_RE]) {
      pattern.lastIndex = 0
      let match = pattern.exec(source)
      while (match !== null) {
        const resolved = resolveSpecifier(match[1], file)
        if (resolved && !importedBy.has(resolved)) {
          importedBy.set(resolved, file)
          queue.push(resolved)
        }
        match = pattern.exec(source)
      }
    }
  }

  return { path: [], visited: importedBy.size }
}

const verbose = process.argv.includes('--verbose')
let failed = false

for (const entry of ENTRIES) {
  const entryPath = join(APP, entry)
  if (!existsSync(entryPath)) {
    console.error(`✗ check-trigger-block-cycle: entry not found: ${entry}`)
    failed = true
    continue
  }

  const { path, visited } = findPathToBlocks(entryPath)
  if (path.length > 0) {
    failed = true
    console.error(`\n✗ ${entry} can statically reach blocks/:\n`)
    console.error(`    ${path.join('\n      -> ')}\n`)
  } else if (verbose) {
    console.log(`✓ ${entry} — ${visited} modules reachable, none under blocks/`)
  }
}

if (failed) {
  console.error(
    'The triggers <-> blocks import cycle is back. Block configs call getTrigger() at module\n' +
      'scope, so a static triggers -> blocks edge makes module evaluation order load-bearing:\n' +
      'importing @/triggers before @/blocks throws\n' +
      "  ReferenceError: Cannot access 'TRIGGER_REGISTRY' before initialization\n\n" +
      'Do not fix this by reordering imports at the call site — that guard is invisible to the\n' +
      'test suite and one unused-import cleanup away from breaking again. Either keep the\n' +
      'dependency out of the triggers/ tree, or load it with a dynamic import() from\n' +
      'apps/sim/triggers/editor-state.ts the way the editor-state readers do.\n'
  )
  process.exit(1)
}

console.log('✓ check-trigger-block-cycle: triggers/ has no static path into blocks/')
