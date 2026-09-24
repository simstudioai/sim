#!/usr/bin/env bun
/**
 * Keeps the dormant indexed organization search behind its gate.
 *
 * `apps/sim/lib/sim-search/indexed/` holds the retrieval over `is_search_index` knowledge bases
 * that Live Search replaced. It stays in the tree for a possible re-enable, switched by
 * `isIndexedOrgSearchEnabled()` in `@/lib/sim-search/indexed/gate`. Dormant code is only safe
 * while nothing reaches it except through that switch, so this audit pins the module edge:
 *
 * - `@/lib/sim-search/indexed/gate` is the switch itself and may be imported from anywhere.
 * - `@/lib/sim-search/indexed` (the use cases) and `@/lib/sim-search/indexed/retrieval` (the
 *   search-index-only retrieval strategies) are imported only by the entry files allowlisted
 *   below, each of which must also import the gate so it can decide before calling in.
 * - Nothing outside the directory reaches past those barrels into a file.
 *
 * Tests are exempt: they exercise the dormant code directly, whatever the switch says.
 *
 * Parsed with the TypeScript AST, so comments and strings naming the module are not imports.
 *
 * Usage: bun run scripts/check-indexed-org-search-boundary.ts
 */
import type { Dirent } from 'node:fs'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from '@typescript/typescript6'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const APP_ROOT = 'apps/sim'
const INDEXED_DIR = 'apps/sim/lib/sim-search/indexed'

export const GATE_SPECIFIER = '@/lib/sim-search/indexed/gate'
export const USE_CASE_BARREL = '@/lib/sim-search/indexed'
export const RETRIEVAL_BARREL = '@/lib/sim-search/indexed/retrieval'

/**
 * The only files allowed to import each barrel, and why. Keep these small: every entry is a
 * surface that can run dormant code, and each must check the gate first.
 */
export const BARREL_ENTRY_FILES: Record<string, Record<string, string>> = {
  [USE_CASE_BARREL]: {
    'apps/sim/app/api/knowledge/search/route.ts':
      'selects the indexed route over the live route only while the gate is on',
    'apps/sim/app/o/[organizationId]/knowledge/[knowledgeBaseId]/[documentId]/page.tsx':
      'indexed citation page; not found while the gate is off',
    'apps/sim/lib/knowledge/mcp/server.ts':
      'registers indexed search and read tools only while the gate is on',
    'apps/sim/lib/mothership/tools/server/knowledge/workspace-search.ts':
      'Sim search and read tools take the indexed branch only while the gate is on',
  },
  [RETRIEVAL_BARREL]: {
    'apps/sim/lib/knowledge/search/queries.ts':
      'shared retrieval; runs the search-index-only strategies only while the gate is on',
  },
}

const SKIP_DIRS = new Set([
  'node_modules',
  '.next',
  '.turbo',
  'dist',
  'coverage',
  '__integration__',
])

export interface BoundaryViolation {
  file: string
  line: number
  specifier: string
  reason: string
}

export interface SourceFile {
  /** Repository-relative path with forward slashes. */
  file: string
  source: string
}

/** Whether a repository-relative path is a test the audit leaves alone. */
export function isTestFile(file: string): boolean {
  return /\.(test|integration)\.tsx?$/.test(file) || file.split('/').includes('__integration__')
}

/** The module specifiers a file loads at runtime or for types, with their lines. */
export function moduleSpecifiers(
  file: string,
  source: string
): Array<{ specifier: string; line: number }> {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, false)
  const found: Array<{ specifier: string; line: number }> = []
  const record = (node: ts.Node, specifier: string) => {
    const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
    found.push({ specifier, line: line + 1 })
  }
  const consumed = new Set<ts.Node>()
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      record(node, node.moduleSpecifier.text)
      consumed.add(node.moduleSpecifier)
    } else if (ts.isCallExpression(node)) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require'
      const argument = node.arguments[0]
      if ((isDynamicImport || isRequire) && argument && ts.isStringLiteralLike(argument)) {
        record(node, argument.text)
        consumed.add(argument)
      }
    } else if (ts.isStringLiteralLike(node) && !consumed.has(node)) {
      /**
       * Any other string naming a module is a specifier too: a dynamic import or `require` of a
       * variable is only as safe as the strings that variable can hold, so the string is where
       * the reach into the dormant directory is caught.
       */
      record(node, node.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return found
}

/** The gate function whose call an entry point must make before reaching indexed search. */
const GATE_FUNCTION = 'isIndexedOrgSearchEnabled'

/**
 * Whether the file calls the gate, under any local name its import gave it. An entry only
 * importing the gate proves nothing: it must ask it. That the call guards each use is left to
 * review of the allowlist, which names every entry explicitly.
 */
export function callsGate(file: string, source: string): boolean {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, false)
  const localNames = new Set<string>()
  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteralLike(statement.moduleSpecifier) ||
      normalizeSpecifier(file, statement.moduleSpecifier.text) !== GATE_SPECIFIER
    )
      continue
    const bindings = statement.importClause?.namedBindings
    if (!bindings || !ts.isNamedImports(bindings)) continue
    for (const element of bindings.elements) {
      if ((element.propertyName ?? element.name).text === GATE_FUNCTION) {
        localNames.add(element.name.text)
      }
    }
  }
  if (localNames.size === 0) return false
  let called = false
  const visit = (node: ts.Node): void => {
    if (called) return
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      localNames.has(node.expression.text)
    ) {
      called = true
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return called
}

/** The `@/`-rooted form of a specifier, resolving a relative one against the importing file. */
function normalizeSpecifier(file: string, specifier: string): string | null {
  if (specifier.startsWith('@/')) return specifier
  if (!specifier.startsWith('.')) return null
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier))
  return resolved.startsWith(`${APP_ROOT}/`) ? `@/${resolved.slice(APP_ROOT.length + 1)}` : null
}

/** Every violation across `files`, which are the non-test sources outside the indexed directory. */
export function findBoundaryViolations(files: readonly SourceFile[]): BoundaryViolation[] {
  const violations: BoundaryViolation[] = []
  const importedBarrels = new Map<string, Set<string>>()
  const sources = new Map<string, string>()
  for (const { file, source } of files) {
    if (file.startsWith(`${INDEXED_DIR}/`) || isTestFile(file)) continue
    /** Any specifier reaching the directory, absolute or relative, names its `indexed` segment. */
    if (!source.includes('indexed')) continue
    for (const { specifier, line } of moduleSpecifiers(file, source)) {
      const normalized = normalizeSpecifier(file, specifier)
      if (
        !normalized ||
        (normalized !== USE_CASE_BARREL && !normalized.startsWith(`${USE_CASE_BARREL}/`))
      )
        continue
      if (normalized === GATE_SPECIFIER) continue
      const entries = BARREL_ENTRY_FILES[normalized]
      if (!entries) {
        violations.push({
          file,
          line,
          specifier,
          reason: `reaches into dormant indexed search; import ${USE_CASE_BARREL} or ${RETRIEVAL_BARREL}`,
        })
        continue
      }
      if (!(file in entries)) {
        violations.push({
          file,
          line,
          specifier,
          reason: `is not an allowlisted entry point for ${normalized}`,
        })
        continue
      }
      sources.set(file, source)
      const barrels = importedBarrels.get(file) ?? new Set<string>()
      barrels.add(normalized)
      importedBarrels.set(file, barrels)
    }
  }
  for (const file of importedBarrels.keys()) {
    if (!callsGate(file, sources.get(file) ?? '')) {
      violations.push({
        file,
        line: 1,
        specifier: GATE_SPECIFIER,
        reason: `reaches dormant indexed search without calling ${GATE_FUNCTION}()`,
      })
    }
  }
  return violations
}

/** Allowlist entries that no longer import their barrel, so the list cannot outlive its callers. */
export function findStaleEntries(files: readonly SourceFile[]): string[] {
  const byFile = new Map(files.map((entry) => [entry.file, entry]))
  const stale: string[] = []
  for (const [barrel, entries] of Object.entries(BARREL_ENTRY_FILES)) {
    for (const file of Object.keys(entries)) {
      const entry = byFile.get(file)
      const imports = entry
        ? moduleSpecifiers(entry.file, entry.source).some(
            ({ specifier }) => normalizeSpecifier(entry.file, specifier) === barrel
          )
        : false
      if (!imports) stale.push(`${file} (${barrel})`)
    }
  }
  return stale
}

function walk(dir: string, out: string[] = []): string[] {
  let entries: Dirent[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    throw new Error(`check-indexed-org-search-boundary: "${dir}" does not exist`)
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full)
  }
  return out
}

function main() {
  const files = walk(path.join(ROOT, APP_ROOT))
    .map((full) => path.relative(ROOT, full).split(path.sep).join('/'))
    .filter((file) => !isTestFile(file))
    .map((file) => ({ file, source: readFileSync(path.join(ROOT, file), 'utf8') }))
  const violations = findBoundaryViolations(files)
  const stale = findStaleEntries(files)
  if (violations.length === 0 && stale.length === 0) {
    console.log(
      `✓ check-indexed-org-search-boundary: ${files.length} files, dormant indexed search reached only through its gate`
    )
    process.exit(0)
  }
  console.error('✗ check-indexed-org-search-boundary: dormant indexed search escaped its gate\n')
  for (const violation of violations) {
    console.error(`    ${violation.file}:${violation.line}  ${violation.specifier}`)
    console.error(`      ${violation.reason}`)
  }
  for (const entry of stale) {
    console.error(`    ${entry}\n      allowlisted but no longer imports the barrel; remove it`)
  }
  console.error(
    '\n  Indexed organization search is dormant. Reach it only from an allowlisted entry point\n' +
      '  that checks isIndexedOrgSearchEnabled() first; see apps/sim/lib/sim-search/indexed/README.md.\n'
  )
  process.exit(1)
}

if (import.meta.main) main()
