/**
 * @vitest-environment node
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Pins the import boundary the catalog exists to protect.
 *
 * `@/tools/registry` is a barrel over 4,300+ tools whose configs hold closures;
 * reaching it costs ~4,700 modules. Everything the catalog reads — a tool's
 * params, outputs, name, or existence — is exactly what the generated metadata
 * artifacts carry, so a single `getTool` import here would be pure cost. The
 * same applies to `@/connectors/registry.server`, whose fetch closures pull
 * `undici` and the server-only input validators in behind them.
 *
 * `scripts/check-tool-registry-boundary.ts` walks these same entries and is the
 * authoritative half: it follows every edge transitively, so it catches a
 * registry import reintroduced one hop away, which the direct-specifier scan
 * below cannot. This test is the cheaper, faster half — it runs in the normal
 * suite, names the offending file directly, and additionally holds `projection/`
 * to the stricter rule that it stay free of HTTP and database imports so it
 * stays surface-neutral.
 */

const APP_ROOT = join(import.meta.dirname, '..', '..')

const CATALOG_ROOTS = [
  'lib/catalog',
  'app/api/v2/blocks',
  'app/api/v2/tools',
  'app/api/v2/connector-types',
] as const

/** Modules no catalog file may import, with what each would drag in. */
const FORBIDDEN_EVERYWHERE: Record<string, string> = {
  '@/tools/registry': 'the executable tool registry (~4,700 modules of tool closures)',
  '@/connectors/registry.server':
    'the server connector registry (fetch closures, undici, server-only validators)',
  '@/tools/utils': 'getTool, which resolves through the executable tool registry',
}

/** Additional modules the pure projection layer may not import. */
const FORBIDDEN_IN_PROJECTION: Record<string, string> = {
  'next/server': 'the HTTP surface; a projection must stay surface-neutral',
  '@sim/db': 'the database; a projection reads code-defined registries only',
  '@/enrichments/run': 'the enrichment cascade runner, which executes tools',
}

function collectSourceFiles(root: string): string[] {
  const found: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.tsx?$/.test(entry.name)) found.push(full)
    }
  }
  walk(join(APP_ROOT, root))
  return found
}

function importedModules(source: string): string[] {
  const specifiers: string[] = []
  const patterns = [
    /(?:^|\n)\s*import\s+(?!type\b)(?:[\s\S]*?from\s*)??['"]([^'"]+)['"]/g,
    /(?:^|\n)\s*export\s+(?!type\b)(?:\*(?:\s+as\s+[\w$]+)?|\{[\s\S]*?\})\s*from\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]
  for (const pattern of patterns) {
    pattern.lastIndex = 0
    let match = pattern.exec(source)
    while (match !== null) {
      specifiers.push(match[1])
      match = pattern.exec(source)
    }
  }
  return specifiers
}

describe('catalog registry boundary', () => {
  const files = CATALOG_ROOTS.flatMap(collectSourceFiles)

  it('finds catalog sources to check', () => {
    expect(files.length).toBeGreaterThan(10)
  })

  it('never imports the executable tool or connector registries', () => {
    for (const file of files) {
      if (file.endsWith('registry-boundary.test.ts')) continue
      const imports = importedModules(readFileSync(file, 'utf8'))
      for (const [specifier, reason] of Object.entries(FORBIDDEN_EVERYWHERE)) {
        expect(
          imports.includes(specifier),
          `${relative(APP_ROOT, file)} imports ${specifier} — ${reason}`
        ).toBe(false)
      }
    }
  })

  it('keeps the projection layer free of HTTP and database imports', () => {
    for (const file of collectSourceFiles('lib/catalog/projection')) {
      if (file.endsWith('.test.ts')) continue
      const imports = importedModules(readFileSync(file, 'utf8'))
      for (const [specifier, reason] of Object.entries(FORBIDDEN_IN_PROJECTION)) {
        expect(
          imports.includes(specifier),
          `${relative(APP_ROOT, file)} imports ${specifier} — ${reason}`
        ).toBe(false)
      }
    }
  })
})
