#!/usr/bin/env bun
/**
 * Enforces use of shared @sim/utils/random and @sim/utils/id helpers.
 *
 * Biome's noRestrictedImports covers import-based bans (nanoid, uuid, crypto named imports).
 * This script catches global property access patterns that static import analysis misses:
 *   - Math.random       → randomInt / randomFloat / randomItem from @sim/utils/random
 *   - crypto.randomUUID → generateId / generateShortId from @sim/utils/id
 *   - crypto.randomBytes → generateRandomBytes / generateRandomHex from @sim/utils/random
 */
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dir, '..')

const SCAN_DIRS = [path.join(ROOT, 'apps'), path.join(ROOT, 'packages')]

const SKIP_DIRS = new Set(['node_modules', 'dist', '.next', '.turbo', 'coverage', 'bundles'])

/** Files that implement the utilities themselves — allowed to use the underlying primitives. */
const ALLOWLISTED_FILES = new Set([
  'packages/utils/src/random.ts',
  'packages/utils/src/id.ts',
  'packages/utils/src/random.test.ts',
  'packages/utils/src/id.test.ts',
])

const BANNED_PATTERNS: Array<{
  pattern: RegExp
  description: string
  suggestion: string
}> = [
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
    console.log('✓ No banned randomness/ID patterns found.')
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
