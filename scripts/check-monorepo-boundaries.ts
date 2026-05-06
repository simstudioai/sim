#!/usr/bin/env bun
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dir, '..')
const PACKAGES_DIR = path.join(ROOT, 'packages')

const FORBIDDEN_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  { pattern: /from\s+['"]@\/(?!\*)/g, description: "'@/' path alias (apps/sim-only)" },
  { pattern: /from\s+['"]\.\.\/\.\.\/apps\//g, description: 'relative import into apps/' },
  { pattern: /from\s+['"]apps\//g, description: "bare 'apps/' import" },
]

const SKIP_DIRS = new Set(['node_modules', 'dist', '.next', '.turbo', 'coverage'])

async function walk(dir: string, results: string[] = []): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
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

async function main() {
  const packagesEntries = await readdir(PACKAGES_DIR, { withFileTypes: true })
  const packageDirs = packagesEntries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(PACKAGES_DIR, entry.name))

  const offenders: Array<{ file: string; line: number; description: string; snippet: string }> = []

  for (const dir of packageDirs) {
    const files = await walk(dir)
    for (const file of files) {
      const content = await readFile(file, 'utf8')
      const lines = content.split('\n')
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        for (const { pattern, description } of FORBIDDEN_PATTERNS) {
          pattern.lastIndex = 0
          if (pattern.test(line)) {
            offenders.push({
              file: path.relative(ROOT, file),
              line: i + 1,
              description,
              snippet: line.trim(),
            })
          }
        }
      }
    }
  }

  if (offenders.length === 0) {
    console.log('✅ Monorepo boundaries OK: no package imports from apps/*')
    return
  }

  console.error('❌ Monorepo boundary violations found:')
  for (const offender of offenders) {
    console.error(
      `  ${offender.file}:${offender.line} — ${offender.description}\n    ${offender.snippet}`
    )
  }
  process.exit(1)
}

void main().catch((error) => {
  console.error('Monorepo boundary check failed:', error)
  process.exit(1)
})
