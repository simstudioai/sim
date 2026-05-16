#!/usr/bin/env bun
/**
 * Enforces use of shared @sim/utils helpers over inline implementations.
 *
 * Biome's noRestrictedImports covers import-based bans (nanoid, uuid, crypto named imports).
 * This script catches patterns that static import analysis misses — global property access,
 * inline idioms, and reimplemented helpers that should live in @sim/utils.
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
    const lines = content.split('\n')

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      for (const { pattern, description, suggestion } of BANNED_PATTERNS) {
        pattern.lastIndex = 0
        if (pattern.test(line)) {
          violations.push({
            file: rel,
            line: i + 1,
            description,
            suggestion,
            snippet: line.trim(),
          })
        }
      }
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
