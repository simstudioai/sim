#!/usr/bin/env bun
/**
 * Enforces structural hygiene rules that Biome cannot cover statically.
 *
 * Checks:
 * 1. @ts-ignore / @ts-expect-error without an explanation comment
 * 2. Bare Next.js route handler exports (missing withRouteHandler wrapper)
 * 3. Banned Vitest anti-patterns in test files
 *
 * Violations can be suppressed per-line with:
 *   // hygiene-suppress: <reason>
 * placed on the line immediately before the flagged line.
 */
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dir, '..')
const APPS_DIR = path.join(ROOT, 'apps')
const PACKAGES_DIR = path.join(ROOT, 'packages')

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  '.next',
  '.turbo',
  'coverage',
  'bundles',
  '.claude',
])

/** Generated directories where @ts-ignore is acceptable. */
const TS_IGNORE_SKIP_PATHS = ['apps/docs/.next/', 'apps/docs/.source/', 'packages/ts-sdk/dist/']

/** Route files that legitimately don't need withRouteHandler. */
const BARE_ROUTE_ALLOWLIST = new Set([
  // Ultra-lightweight health check — no logging, no tracing needed
  'apps/sim/app/api/health/route.ts',
  // Delegates directly to copilot stream handler which has its own context
  'apps/sim/app/api/mothership/chat/stream/route.ts',
])

const SUPPRESSION_COMMENT = /\/\/\s*hygiene-suppress\s*:/

interface Violation {
  file: string
  line: number
  description: string
  snippet: string
}

async function walk(
  dir: string,
  filter: (name: string) => boolean,
  results: string[] = []
): Promise<string[]> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return results
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      await walk(full, filter, results)
    } else if (filter(entry.name)) {
      results.push(full)
    }
  }
  return results
}

function isSuppressed(lines: string[], lineIndex: number): boolean {
  if (lineIndex > 0 && SUPPRESSION_COMMENT.test(lines[lineIndex - 1])) return true
  return false
}

// ─── Check 1: @ts-ignore / @ts-expect-error without explanation ──────────────

const TS_SUPPRESS_PATTERN = /@ts-(?:ignore|expect-error)\s*$/

async function checkTsIgnore(violations: Violation[]) {
  const allFiles: string[] = []
  for (const dir of [APPS_DIR, PACKAGES_DIR]) {
    await walk(dir, (name) => /\.(ts|tsx|mts|cts)$/.test(name), allFiles)
  }

  for (const file of allFiles) {
    const rel = path.relative(ROOT, file)
    if (TS_IGNORE_SKIP_PATHS.some((p) => rel.startsWith(p))) continue

    const content = await readFile(file, 'utf8')
    const lines = content.split('\n')

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (TS_SUPPRESS_PATTERN.test(line.trimEnd())) {
        if (isSuppressed(lines, i)) continue
        violations.push({
          file: rel,
          line: i + 1,
          description: '@ts-ignore / @ts-expect-error without explanation',
          snippet: line.trim(),
        })
      }
    }
  }
}

// ─── Check 2: Bare Next.js route exports ─────────────────────────────────────

/** Matches `export async function GET/POST/PUT/DELETE/PATCH(` */
const BARE_ROUTE_PATTERN =
  /^export\s+(?:async\s+)?function\s+(?:GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s*\(/

async function checkBareRoutes(violations: Violation[]) {
  const routeFiles: string[] = []
  await walk(
    path.join(APPS_DIR, 'sim', 'app', 'api'),
    (name) => name === 'route.ts' || name === 'route.tsx',
    routeFiles
  )

  for (const file of routeFiles) {
    const rel = path.relative(ROOT, file)
    if (BARE_ROUTE_ALLOWLIST.has(rel)) continue

    const content = await readFile(file, 'utf8')
    const lines = content.split('\n')

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (BARE_ROUTE_PATTERN.test(line)) {
        if (isSuppressed(lines, i)) continue
        violations.push({
          file: rel,
          line: i + 1,
          description:
            'Bare route export — wrap with withRouteHandler from @/lib/core/utils/with-route-handler',
          snippet: line.trim(),
        })
      }
    }
  }
}

// ─── Check 3: Banned Vitest anti-patterns ────────────────────────────────────

const VITEST_ANTI_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  {
    pattern: /\bvi\.doMock\s*\(/,
    description: 'vi.doMock() — use vi.hoisted() + vi.mock() + static imports instead',
  },
  {
    pattern: /\bvi\.resetModules\s*\(/,
    description:
      'vi.resetModules() — use vi.hoisted() + vi.mock() + static imports instead (exception: singleton modules that cache state)',
  },
  {
    pattern: /\bvi\.importActual\s*(?:<[^>]*>)?\s*\(/,
    description: 'vi.importActual() — mock everything explicitly instead',
  },
]

async function checkVitestAntiPatterns(violations: Violation[]) {
  const testFiles: string[] = []
  for (const dir of [APPS_DIR, PACKAGES_DIR]) {
    await walk(dir, (name) => /\.test\.(ts|tsx)$/.test(name), testFiles)
  }

  for (const file of testFiles) {
    const rel = path.relative(ROOT, file)
    const content = await readFile(file, 'utf8')
    const lines = content.split('\n')

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      for (const { pattern, description } of VITEST_ANTI_PATTERNS) {
        if (pattern.test(line)) {
          if (isSuppressed(lines, i)) continue
          violations.push({
            file: rel,
            line: i + 1,
            description,
            snippet: line.trim(),
          })
        }
      }
    }
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const violations: Violation[] = []

  await Promise.all([
    checkTsIgnore(violations),
    checkBareRoutes(violations),
    checkVitestAntiPatterns(violations),
  ])

  if (violations.length === 0) {
    console.log('✓ No hygiene violations found.')
    process.exit(0)
  }

  console.error(`\nFound ${violations.length} hygiene violation(s):\n`)
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}`)
    console.error(`    ✗ ${v.description}`)
    console.error(`    ${v.snippet}\n`)
  }
  process.exit(1)
}

main()
