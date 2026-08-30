#!/usr/bin/env bun
/**
 * Asserts the authorization funnel's module graph stays light.
 *
 * `@/lib/core/application` is imported by ~every domain `operations.ts`, and
 * `lib/permission-groups/capabilities.ts` sits below it, so anything either one
 * reaches at runtime is loaded by every surface that authorizes anything —
 * routes, jobs, the realtime prune graph and every use-case unit test. The
 * provider registry, the block/tool registries, the executor and the
 * uploads/workflow graph are all far heavier than an authorization decision,
 * and none of them has anything to say about one.
 *
 * The edge this guards against is invisible without a check: adding one import
 * to a permission-group helper once widened this graph as far as
 * `lib/uploads/utils/file-utils.ts`, and the only symptom was two unrelated
 * knowledge tests failing on a partial mock of a module they never meant to
 * load.
 *
 * Walks runtime `import`/`export … from` specifiers only. `import type` is
 * erased by the compiler and costs nothing at runtime, so a type-only edge into
 * a forbidden module is allowed and deliberately not reported.
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(SCRIPT_DIR, '..')
const APP_ROOT = resolve(REPO_ROOT, 'apps/sim')

/** Entry points whose graph every authorization decision pays for. */
export const GUARDED_ROOTS = [
  'lib/core/application/index.ts',
  'lib/permission-groups/capabilities.ts',
  'lib/permission-groups/capability-assertions.ts',
  'lib/permission-groups/config-scope.server.ts',
] as const

/**
 * Path prefixes no guarded root may reach at runtime, with the reason a reviewer
 * needs to understand the failure without re-deriving this file.
 */
export const FORBIDDEN_PREFIXES: Record<string, string> = {
  'providers/': 'the LLM provider registry — an authorization decision never picks a model',
  'blocks/': 'the block registry — it pulls every block definition into the graph',
  'tools/': 'the executable tool registry — see the tool-registry-boundary skill',
  'executor/': 'the workflow execution engine',
  'lib/uploads/': 'the uploads graph, which reaches file parsing and archive handling',
  'lib/workflows/': 'the workflow graph, which reaches the editor and serializer',
}

/**
 * Matches a runtime `import … from '…'` or `export … from '…'`.
 *
 * The negative lookahead drops `import type {` and `import type X`, which the
 * compiler erases; `import { type A }` still counts, because that statement
 * emits a runtime require for the module.
 */
const IMPORT_PATTERN =
  /(?:^|\n)\s*(?:import|export)\s+(?!type[\s{])[\s\S]*?\s*from\s*['"]([^'"]+)['"]/g

/** Resolves an `@/`- or relative specifier to a file under `apps/sim`, or null. */
export function resolveSpecifier(specifier: string, fromFile: string): string | null {
  const base = specifier.startsWith('@/')
    ? resolve(APP_ROOT, specifier.slice(2))
    : specifier.startsWith('.')
      ? resolve(dirname(fromFile), specifier)
      : null
  if (base === null) return null

  for (const candidate of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate
  }
  return null
}

/** The runtime specifiers `source` imports, in source order. */
export function runtimeSpecifiers(source: string): string[] {
  return [...source.matchAll(IMPORT_PATTERN)].map((match) => match[1])
}

export interface GraphViolation {
  root: string
  forbidden: string
  reason: string
  path: string[]
}

/**
 * Breadth-first walk from `root`, reporting the shortest import chain into each
 * forbidden prefix. Breadth-first on purpose: the shortest chain is the one a
 * reader can act on, and it names the single edge worth deleting.
 */
export function findViolations(root: string): GraphViolation[] {
  const start = resolve(APP_ROOT, root)
  const violations: GraphViolation[] = []
  const reported = new Set<string>()
  const seen = new Set([start])
  const queue: Array<[string, string[]]> = [[start, [start]]]

  while (queue.length > 0) {
    const [file, path] = queue.shift() as [string, string[]]
    let source: string
    try {
      source = readFileSync(file, 'utf8')
    } catch {
      continue
    }

    for (const specifier of runtimeSpecifiers(source)) {
      const next = resolveSpecifier(specifier, file)
      if (next === null || seen.has(next)) continue

      const rel = relative(APP_ROOT, next)
      const prefix = Object.keys(FORBIDDEN_PREFIXES).find((candidate) => rel.startsWith(candidate))
      if (prefix !== undefined) {
        if (!reported.has(prefix)) {
          reported.add(prefix)
          violations.push({
            root,
            forbidden: rel,
            reason: FORBIDDEN_PREFIXES[prefix],
            path: [...path, next].map((entry) => relative(APP_ROOT, entry)),
          })
        }
        continue
      }

      seen.add(next)
      queue.push([next, [...path, next]])
    }
  }

  return violations
}

function main(): void {
  const violations: GraphViolation[] = []
  for (const root of GUARDED_ROOTS) {
    if (!existsSync(resolve(APP_ROOT, root))) {
      console.error(
        `Application-graph audit could not find its own root '${root}'.\n` +
          'The module was renamed or moved. Update GUARDED_ROOTS rather than leaving this\n' +
          'audit passing over a file that no longer exists.\n'
      )
      process.exit(1)
    }
    violations.push(...findViolations(root))
  }

  if (violations.length > 0) {
    console.error('❌ The authorization funnel reaches modules it must not load at runtime:\n')
    for (const violation of violations) {
      console.error(`  ${violation.forbidden} — ${violation.reason}`)
      console.error(`    ${violation.path.join('\n      -> ')}\n`)
    }
    console.error(
      'Move the code that needs the heavy module out of the funnel, or import it only as a\n' +
        "type. Do not add the module to FORBIDDEN_PREFIXES' exceptions.\n"
    )
    process.exit(1)
  }

  console.log(
    `✅ Application graph clean: ${GUARDED_ROOTS.length} roots reach none of ` +
      `${Object.keys(FORBIDDEN_PREFIXES).length} forbidden module trees`
  )
}

if (import.meta.main) main()
