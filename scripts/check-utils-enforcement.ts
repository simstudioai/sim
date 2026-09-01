#!/usr/bin/env bun
/**
 * Enforces use of shared @sim/utils helpers over inline implementations.
 *
 * Biome's noRestrictedImports covers the import-based bans it lists — today `nanoid` and
 * `uuid`. It does NOT cover named crypto imports; `import { randomBytes } from 'node:crypto'`
 * passes both gates, and deliberately so, since server code building cipher IVs and tokens
 * wants node's crypto rather than the cross-context wrapper in `@sim/utils/random`.
 *
 * This script catches what static import analysis misses — global property access, inline
 * idioms, and reimplemented helpers that should live in @sim/utils.
 *
 * Patterns are matched against the whole file, not line by line: every idiom banned here is a
 * multi-token expression that the formatter wraps at 100 columns, and a line-scoped scan sees
 * none of the wrapped forms. Deliberate exceptions carry `// utils-lint-allow: <reason>`.
 */
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dir, '..')

const SCAN_DIRS = [path.join(ROOT, 'apps'), path.join(ROOT, 'packages')]

const SKIP_DIRS = new Set(['node_modules', 'dist', '.next', '.turbo', 'coverage', 'bundles'])

/** Files that implement the utilities themselves — allowed to use the underlying primitives. */
const ALLOWLISTED_FILES = new Set([
  'packages/utils/src/errors.ts',
  'packages/utils/src/helpers.ts',
  'packages/utils/src/random.ts',
  'packages/utils/src/id.ts',
  'packages/utils/src/object.ts',
  'packages/utils/src/retry.ts',
  'packages/utils/src/errors.test.ts',
  'packages/utils/src/helpers.test.ts',
  'packages/utils/src/random.test.ts',
  'packages/utils/src/id.test.ts',
  'packages/utils/src/object.test.ts',
  'packages/utils/src/retry.test.ts',
  // Published standalone CLIs: `@sim/utils` is private, so they carry local
  // copies rather than a dependency that only resolves inside the monorepo.
  'packages/sim-cli/src/helpers.ts',
  'packages/cli/src/index.ts',
  'packages/ts-sdk/src/index.ts',
  // CJS bundle — cannot use ES module imports
  'apps/sim/lib/execution/isolated-vm-worker.cjs',
  // Uses crypto.getRandomValues() directly (not crypto.randomUUID) — TSDoc comment triggers false positive
  'packages/testing/src/factories/id.ts',
])

const BANNED_PATTERNS: Array<{
  pattern: RegExp
  description: string
  suggestion: string
}> = [
  // Randomness / ID generation — global property access that import bans miss
  {
    pattern: /\bMath\.random\s*\(/g,
    description: 'Math.random()',
    suggestion: 'randomInt / randomFloat / randomItem from @sim/utils/random',
  },
  {
    pattern: /\bcrypto\.randomUUID\s*\(/g,
    description: 'crypto.randomUUID()',
    suggestion: 'generateId() or generateShortId() from @sim/utils/id',
  },
  {
    pattern: /\bcrypto\.randomBytes\s*\(/g,
    description: 'crypto.randomBytes()',
    suggestion: 'generateRandomBytes() or generateRandomHex() from @sim/utils/random',
  },
  // Deep clone idiom
  {
    pattern: /JSON\.parse\s*\(\s*JSON\.stringify\s*\(/g,
    description: 'JSON.parse(JSON.stringify(...))',
    suggestion: 'structuredClone() — built-in, no import needed',
  },
  // Inline error message extraction (excludes null/undefined/false fallbacks — those have different semantics)
  {
    pattern: /instanceof Error\s*\?\s*\w+\.message\s*:\s*(?!\s*null\b|\s*undefined\b|\s*false\b)./g,
    description: 'e instanceof Error ? e.message : fallback',
    suggestion: 'getErrorMessage(e, fallback?) from @sim/utils/errors',
  },
  // Inline sleep
  {
    pattern: /new Promise\s*[(<]\s*(?:resolve|\(resolve\))\s*=>\s*setTimeout\s*\(\s*resolve/g,
    description: 'new Promise(resolve => setTimeout(resolve, ms))',
    suggestion: 'sleep(ms) from @sim/utils/helpers',
  },
]

async function walk(dir: string, results: string[] = []): Promise<string[]> {
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
      await walk(full, results)
    } else if (/\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(entry.name)) {
      results.push(full)
    }
  }
  return results
}

interface Violation {
  file: string
  line: number
  description: string
  suggestion: string
  snippet: string
}

/** Escape hatch for a deliberate use, mirroring `rq-lint-allow:` in check-react-query-patterns.ts. */
const ALLOW = 'utils-lint-allow:'

/** Offset of the first character of each line, for mapping a match index back to a line number. */
function buildLineStarts(content: string): number[] {
  const starts = [0]
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '\n') starts.push(i + 1)
  }
  return starts
}

/** 1-based line containing `offset`, by binary search over {@link buildLineStarts}. */
function lineAt(lineStarts: number[], offset: number): number {
  let low = 0
  let high = lineStarts.length - 1
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (lineStarts[mid] <= offset) low = mid
    else high = mid - 1
  }
  return low + 1
}

/**
 * True if a `// utils-lint-allow: <reason>` annotation sits just above `line` (1-based).
 *
 * The reason must be non-empty: an annotation that does not say why is the thing this
 * check exists to prevent. Scans up to three comment lines above, so the annotation can
 * carry context lines with it.
 */
function hasAllow(lines: string[], line: number): boolean {
  for (let i = line - 2; i >= 0 && i >= line - 5; i--) {
    const text = lines[i]?.trim() ?? ''
    if (text.includes(ALLOW)) {
      return text.slice(text.indexOf(ALLOW) + ALLOW.length).trim().length > 0
    }
    if (text.length > 0 && !text.startsWith('//') && !text.startsWith('*')) break
  }
  return false
}

async function main() {
  const allFiles: string[] = []
  for (const dir of SCAN_DIRS) {
    await walk(dir, allFiles)
  }

  const violations: Violation[] = []

  for (const file of allFiles) {
    const rel = path.relative(ROOT, file)
    if (ALLOWLISTED_FILES.has(rel)) continue

    const content = await readFile(file, 'utf8')
    const matches: Array<{
      index: number
      description: string
      suggestion: string
    }> = []

    for (const { pattern, description, suggestion } of BANNED_PATTERNS) {
      pattern.lastIndex = 0
      for (let match = pattern.exec(content); match !== null; match = pattern.exec(content)) {
        matches.push({ index: match.index, description, suggestion })
      }
    }
    if (matches.length === 0) continue

    const lines = content.split('\n')
    const lineStarts = buildLineStarts(content)
    for (const match of matches) {
      const line = lineAt(lineStarts, match.index)
      if (hasAllow(lines, line)) continue
      violations.push({
        file: rel,
        line,
        description: match.description,
        suggestion: match.suggestion,
        snippet: (lines[line - 1] ?? '').trim(),
      })
    }
  }

  if (violations.length === 0) {
    console.log('✓ No banned patterns found.')
    process.exit(0)
  }

  console.error(`\nFound ${violations.length} banned pattern(s):\n`)
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}`)
    console.error(`    ✗ ${v.description} → use ${v.suggestion}`)
    console.error(`    ${v.snippet}\n`)
  }
  process.exit(1)
}

main()
