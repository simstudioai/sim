#!/usr/bin/env bun
/**
 * Fails if a workspace route can reach the executable tool registry.
 *
 * `@/tools/registry` is a barrel over 4,300+ tools whose `ToolConfig`s hold
 * closures (`request.headers`, `transformResponse`, `directExecution`). Those
 * closures reach every integration's SDK client and parser, so reaching the
 * barrel costs ~4,700 modules — it was 71-82% of every workspace route's module
 * graph until those edges were cut.
 *
 * Client-reachable code reads `@/tools/metadata`, `@/tools/metadata-outputs` or
 * `@/tools/tool-ids` instead. See
 * `.agents/skills/tool-registry-boundary/SKILL.md`.
 *
 * This regresses silently and cheaply: any file under a route can import one
 * helper from a module that happens to import `getTool`, and the whole registry
 * comes back. That is exactly how it got there — `providers/utils.ts` pulled it
 * in through `mergeToolParameters`, and `mcp-dynamic-args.tsx` through
 * `formatParameterLabel`. Neither import looks remotely suspicious at the call
 * site, which is why this is a lint and not a convention.
 *
 * Usage:
 *   bun run scripts/check-tool-registry-boundary.ts
 *   bun run scripts/check-tool-registry-boundary.ts --verbose   # print counts
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(SCRIPT_DIR, '..')
const APP = join(ROOT, 'apps/sim')

/** Module no client-reachable entry may reach. */
const FORBIDDEN = join(APP, 'tools/registry.ts')

/**
 * Root the guard walks: every `page.tsx` and `layout.tsx` under the workspace app.
 *
 * Discovered rather than listed. A hardcoded list goes stale silently — the
 * first version of this guard named `app/workspace/layout.tsx` as "the shared
 * shell", but that file only wraps `SocketProvider`; the real shell is
 * `app/workspace/[workspaceId]/layout.tsx`, which was never checked.
 *
 * Layouts must be enumerated separately because Next.js composes them by
 * convention — a page does not `import` its layout, so walking pages alone never
 * reaches layout modules even though every route pays for them.
 */
const ENTRY_ROOT = 'app/workspace'
const ENTRY_FILENAMES = new Set(['page.tsx', 'layout.tsx'])

function collectEntries(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) collectEntries(full, found)
    else if (ENTRY_FILENAMES.has(entry.name)) found.push(relative(APP, full))
  }
  return found
}

const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs']

/**
 * Matches value imports and re-exports, skipping `import type` and
 * `export type` — a type-only edge is erased at compile time and costs nothing.
 *
 * `REEXPORT_RE` allows an alias after the star so `export * as ns from` is not
 * missed, and `DYNAMIC_IMPORT_RE` covers `import('…')`. A dynamic import splits
 * the registry into its own chunk rather than the route's initial one, but it
 * still puts 4,300 tools' worth of executable config on a client path, so it
 * counts as reaching it — and the settings route's registry edge hid behind
 * exactly such an import.
 *
 * `REQUIRE_RE` matters for the same reason: this codebase uses lazy
 * `require('@/…')` to break import cycles (`tools/params.ts` reaches `@/blocks`
 * that way), and those edges are as real as static ones.
 */
const IMPORT_RE = /(?:^|\n)\s*import\s+(?!type\b)(?:[\s\S]*?from\s*)?['"]([^'"]+)['"]/g
const REEXPORT_RE =
  /(?:^|\n)\s*export\s+(?!type\b)(?:\*(?:\s+as\s+[\w$]+)?|\{[\s\S]*?\})\s*from\s*['"]([^'"]+)['"]/g
const DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g
const REQUIRE_RE = /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g

/** Resolves `@/` and relative specifiers. Bare package specifiers are ignored. */
function resolveSpecifier(specifier: string, importer: string): string | null {
  let base: string
  if (specifier.startsWith('@/')) base = join(APP, specifier.slice(2))
  else if (specifier.startsWith('.')) base = resolve(dirname(importer), specifier)
  else return null

  // An already-extensioned specifier (`@/tools/registry.ts`) resolves as-is.
  // Probing only `base + ext` would miss it and silently drop the edge — and
  // extensionful `@/` imports do exist in this repo.
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

interface Walk {
  reachable: Set<string>
  importedBy: Map<string, string>
}

function walk(entry: string): Walk {
  const reachable = new Set<string>()
  const importedBy = new Map<string, string>()
  const queue = [entry]
  reachable.add(entry)

  while (queue.length > 0) {
    const file = queue.pop() as string
    let source: string
    try {
      source = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    for (const pattern of [IMPORT_RE, REEXPORT_RE, DYNAMIC_IMPORT_RE, REQUIRE_RE]) {
      pattern.lastIndex = 0
      let match = pattern.exec(source)
      while (match !== null) {
        const resolved = resolveSpecifier(match[1], file)
        if (resolved && !reachable.has(resolved)) {
          reachable.add(resolved)
          importedBy.set(resolved, file)
          queue.push(resolved)
        }
        match = pattern.exec(source)
      }
    }
  }

  return { reachable, importedBy }
}

/** Walks parent links back to the entry so the offending edge is obvious. */
function explainChain({ importedBy }: Walk, target: string): string[] {
  const chain: string[] = []
  let current: string | undefined = target
  while (current) {
    chain.push(relative(ROOT, current))
    current = importedBy.get(current)
  }
  return chain.reverse()
}

function main() {
  const verbose = process.argv.includes('--verbose')
  const failures: string[] = []

  const entryRoot = join(APP, ENTRY_ROOT)
  if (!existsSync(entryRoot)) {
    console.error(`❌ ${ENTRY_ROOT} no longer exists — update ENTRY_ROOT in this script.`)
    process.exit(1)
  }
  const entries = collectEntries(entryRoot).sort()
  if (entries.length === 0) {
    console.error(
      `❌ No page/layout entries found under ${ENTRY_ROOT}. Refusing to pass vacuously.`
    )
    process.exit(1)
  }

  for (const entry of entries) {
    const entryPath = join(APP, entry)
    const result = walk(entryPath)
    if (result.reachable.has(FORBIDDEN)) {
      failures.push(entry)
      console.error(`\n❌ ${entry} can reach @/tools/registry via:`)
      for (const step of explainChain(result, FORBIDDEN)) {
        console.error(`     ${step}`)
      }
    } else if (verbose) {
      console.log(`✓ ${entry} — ${result.reachable.size} modules, registry unreachable`)
    }
  }

  if (failures.length > 0) {
    console.error(
      `\n${failures.length} route(s) reach the executable tool registry, which adds ~4,700 modules to each.`
    )
    console.error(
      'Read the metadata instead: `@/tools/metadata` (params), `@/tools/metadata-outputs`'
    )
    console.error(
      '(outputs), or `@/tools/tool-ids` (existence/resolution). Only code that executes a tool'
    )
    console.error('may import `getTool`. See .agents/skills/tool-registry-boundary/SKILL.md.')
    process.exit(1)
  }

  console.log(`✓ tool registry stays out of ${entries.length} workspace page/layout graphs`)
}

main()
