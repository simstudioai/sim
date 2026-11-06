#!/usr/bin/env bun
/**
 * Import boundaries no type-check can see.
 *
 * 1. Packages never import from `apps/*`. Dependencies point toward shared code: a package that
 *    reaches into an app drags that app's module graph (Next.js, the block and tool registries,
 *    the executor) into every other consumer, including `apps/realtime`. Flagged, including
 *    type-only imports, re-exports, `import()` and `require()`: an `@/…` or `apps/…` specifier,
 *    an app's package name (or a subpath of it), and a relative path that resolves into
 *    `apps/`. Fix by moving the shared code into a package both sides import, or by keeping the
 *    code that needs it in the app.
 * 2. Application code (every non-test file under an `application/` folder in `apps/sim`) stays
 *    surface-neutral, so internal routes, v2, Copilot and jobs can all call the same use case:
 *    - never `next/server` or `@/app/api/**`, not even for a type;
 *    - never, at runtime, a route contract object (a `*Contract` binding from
 *      `@/lib/api/contracts`), a presenter module (`*-presenter(s)`) or a Copilot handler
 *      (`@/lib/mothership/tools/{handlers,server}/**`). Contract types, schemas and constants
 *      are shared domain vocabulary and stay allowed, as does `import type` of a Copilot
 *      context type.
 *    Fix by taking the surface fact (a cursor's route identity, a wire shape) as input from
 *    the adapter.
 *
 * 3. The organization surface's seam points one way. `apps/sim/platform/lib` never imports
 *    `@/platform/app`, not even for a type: views depend on the data layer, and a data file that
 *    reached back into a view could not be read or tested without it. Fix by moving what both
 *    need under `platform/lib`.
 * 4. Views (`apps/sim/platform/app`) read data through `platform/lib/data`, so a read gets one
 *    adaptation and one place to fix it: no runtime edge to a data hook, in `@/hooks/queries` or
 *    a `hooks` folder under `@/ee`. Domain primitives elsewhere in `@/ee` (`lib`, constants,
 *    labels) are not data, and views import them directly. Fix with a data file that adapts the
 *    read. A file that only re-exports a hook satisfies this rule on paper and fixes nothing, so
 *    do not add one.
 *
 * Rules 1 to 3 have no allowlist. Rule 4 predates this check, so its existing edges are counted per
 * file in `scripts/check-monorepo-boundaries.baseline.json`. A file above its count fails, and so
 * does one below it until the baseline is rewritten, so the baseline only shrinks. Regenerate after
 * removing edges with `--update`, which refuses to raise a count; `--update --init` only creates a
 * missing baseline.
 *
 * Run: `bun run check:boundaries`
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import ts from '@typescript/typescript6'

const ROOT = path.resolve(import.meta.dir, '..')
const PACKAGES_DIR = path.join(ROOT, 'packages')
const SIM_DIR = path.join(ROOT, 'apps/sim')
const PLATFORM_LIB_DIR = path.join(SIM_DIR, 'platform/lib')
const PLATFORM_VIEWS_DIR = path.join(SIM_DIR, 'platform/app')
const EE_DATA_HOOK = /^@\/ee\/(?:.+\/)?hooks(?:\/|$)/
const VIEW_SEAM_BASELINE = path.join(ROOT, 'scripts/check-monorepo-boundaries.baseline.json')

const TEST_FILE = /\.(test|spec|integration)\.tsx?$/

function matchesModule(specifier: string, module: string): boolean {
  return specifier === module || specifier.startsWith(`${module}/`)
}

/**
 * A relative specifier rewritten into its `@/…` form against the importing file
 * (the `apps/sim` root is `@/`), so the application rules see one spelling.
 * Bare and already-aliased specifiers, and relative ones leaving `apps/sim`,
 * come back unchanged.
 */
function aliasedSpecifier(file: string, specifier: string): string {
  if (!specifier.startsWith('.')) return specifier
  const target = path.relative(SIM_DIR, path.resolve(path.dirname(file), specifier))
  if (target.startsWith('..') || path.isAbsolute(target)) return specifier
  return target ? `@/${target.split(path.sep).join('/')}` : '@'
}

/**
 * Why an application file may not take this import edge, or `null` when it may.
 * An empty `bindings` list is an edge the compiler erases.
 */
function applicationViolation(
  specifier: string,
  bindings: readonly string[] | 'all'
): string | null {
  if (matchesModule(specifier, 'next/server') || matchesModule(specifier, '@/app/api')) {
    return `application code imports a surface module: ${specifier}`
  }
  if (bindings !== 'all' && bindings.length === 0) return null
  if (
    matchesModule(specifier, '@/lib/mothership/tools/handlers') ||
    matchesModule(specifier, '@/lib/mothership/tools/server')
  ) {
    return `application code imports a Copilot handler: ${specifier}`
  }
  if (specifier.startsWith('@/') && /(^|[/-])presenters?(\.[cm]?[jt]sx?)?$/.test(specifier)) {
    return `application code imports a presenter: ${specifier}`
  }
  if (matchesModule(specifier, '@/lib/api/contracts')) {
    const contracts =
      bindings === 'all' ? ['*'] : bindings.filter((name) => name.endsWith('Contract'))
    if (contracts.length > 0) {
      return `application code imports route contract ${contracts.join(', ')} from ${specifier}; take the surface fact as input from the adapter`
    }
  }
  return null
}

/** Why a view may not take this import edge, or `null` when it may. */
function viewSeamViolation(specifier: string, bindings: readonly string[] | 'all'): string | null {
  if (bindings !== 'all' && bindings.length === 0) return null
  if (matchesModule(specifier, '@/hooks/queries') || EE_DATA_HOOK.test(specifier)) {
    return `view reads a data hook around platform/lib/data: ${specifier}`
  }
  return null
}

/**
 * Runtime (non-type) names an import/export declaration binds: `'all'` for a
 * namespace, default, star, empty-clause or side-effect edge, `[]` for one the compiler erases.
 */
function runtimeBindings(node: ts.ImportDeclaration | ts.ExportDeclaration): string[] | 'all' {
  if (ts.isImportDeclaration(node)) {
    const clause = node.importClause
    if (!clause) return 'all'
    if (clause.isTypeOnly) return []
    if (clause.name) return 'all'
    const named = clause.namedBindings
    if (!named) return []
    if (ts.isNamespaceImport(named) || named.elements.length === 0) return 'all'
    return named.elements
      .filter((element) => !element.isTypeOnly)
      .map((element) => (element.propertyName ?? element.name).text)
  }
  if (node.isTypeOnly) return []
  const clause = node.exportClause
  if (!clause || ts.isNamespaceExport(clause) || clause.elements.length === 0) return 'all'
  return clause.elements
    .filter((element) => !element.isTypeOnly)
    .map((element) => (element.propertyName ?? element.name).text)
}

interface ImportEdge {
  module: ts.StringLiteralLike
  /** See {@link runtimeBindings}; dynamic `import()` and `require` bind `'all'`. */
  bindings: string[] | 'all'
}

/** Every static, type-level and dynamic module reference in a file. */
function importEdges(source: ts.SourceFile): ImportEdge[] {
  const edges: ImportEdge[] = []
  function visit(node: ts.Node): void {
    let module: ts.Node | undefined
    let bindings: string[] | 'all' = 'all'
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      module = node.moduleSpecifier
      bindings = runtimeBindings(node)
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      module = node.moduleReference.expression
      if (node.isTypeOnly) bindings = []
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      module = node.argument.literal
      bindings = []
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    ) {
      module = node.arguments[0]
    }
    if (module && ts.isStringLiteralLike(module)) edges.push({ module, bindings })
    ts.forEachChild(node, visit)
  }
  visit(source)
  return edges
}

interface Offender {
  file: string
  line: number
  description: string
  snippet: string
}

/** Parses `file` and reports each import edge `violation` describes. */
async function scanImports(
  file: string,
  violation: (edge: ImportEdge) => string | null
): Promise<Offender[]> {
  const content = await readFile(file, 'utf8')
  const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true)
  const lines = content.split('\n')
  const offenders: Offender[] = []
  for (const edge of importEdges(source)) {
    const description = violation(edge)
    if (!description) continue
    const { line } = source.getLineAndCharacterOfPosition(edge.module.getStart(source))
    offenders.push({
      file: path.relative(ROOT, file),
      line: line + 1,
      description,
      snippet: lines[line].trim(),
    })
  }
  return offenders
}

/** Package dependencies point toward shared code, including type-only imports. */
function forbiddenImport(file: string, specifier: string, appNames: ReadonlySet<string>): boolean {
  if (specifier.startsWith('@/') || specifier.startsWith('apps/')) return true
  for (const name of appNames) {
    if (specifier === name || specifier.startsWith(`${name}/`)) return true
  }
  if (!specifier.startsWith('.')) return false
  const target = path.relative(ROOT, path.resolve(path.dirname(file), specifier))
  return target === 'apps' || target.startsWith(`apps${path.sep}`)
}

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

/** Every file under `dir` but tests; a directory that does not exist has none. */
async function sourceFiles(dir: string): Promise<string[]> {
  const files = await walk(dir).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return []
    throw error
  })
  return files.filter((file) => !TEST_FILE.test(file))
}

type ViewSeamBaseline = Record<string, number>

function readViewSeamBaseline(): ViewSeamBaseline | null {
  if (!existsSync(VIEW_SEAM_BASELINE)) return null
  return JSON.parse(readFileSync(VIEW_SEAM_BASELINE, 'utf8')) as ViewSeamBaseline
}

function writeViewSeamBaseline(counts: ViewSeamBaseline): void {
  const sorted = Object.fromEntries(
    Object.entries(counts).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  )
  writeFileSync(VIEW_SEAM_BASELINE, `${JSON.stringify(sorted, null, 2)}\n`)
}

/** Rewrites the baseline, or returns why it may not: a count only ever falls. */
function updateViewSeamBaseline(
  baseline: ViewSeamBaseline | null,
  counts: ViewSeamBaseline
): string[] {
  if (baseline === null) {
    if (!process.argv.includes('--init')) {
      return ['the view seam baseline is missing: restore it, or create one with --update --init']
    }
    writeViewSeamBaseline(counts)
    return []
  }
  const refused = Object.entries(counts).flatMap(([file, count]) =>
    count > (baseline[file] ?? 0)
      ? [`refused to raise ${file}: ${count} (baseline ${baseline[file] ?? 0}); fix it instead`]
      : []
  )
  if (refused.length === 0) writeViewSeamBaseline(counts)
  return refused
}

/** Files past their count, each with its edges, and baselined files now below it. */
function viewSeamFailures(baseline: ViewSeamBaseline | null, hits: readonly Offender[]) {
  const counts: ViewSeamBaseline = {}
  for (const hit of hits) counts[hit.file] = (counts[hit.file] ?? 0) + 1
  const allowed = baseline ?? {}
  const raised = hits.filter((hit) => counts[hit.file] > (allowed[hit.file] ?? 0))
  const dropped = Object.entries(allowed).flatMap(([file, count]) =>
    (counts[file] ?? 0) < count ? [`${file}: ${counts[file] ?? 0} (baseline ${count})`] : []
  )
  return { counts, raised, dropped }
}

async function main() {
  const appNames = new Set<string>()
  for (const entry of await readdir(path.join(ROOT, 'apps'), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const content = await readFile(
      path.join(ROOT, 'apps', entry.name, 'package.json'),
      'utf8'
    ).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null
      throw error
    })
    if (content === null) continue
    const manifest = JSON.parse(content) as { name?: string }
    if (typeof manifest.name === 'string') appNames.add(manifest.name)
  }

  const packagesEntries = await readdir(PACKAGES_DIR, { withFileTypes: true })
  const packageDirs = packagesEntries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(PACKAGES_DIR, entry.name))

  const offenders: Offender[] = []

  for (const dir of packageDirs) {
    for (const file of await walk(dir)) {
      offenders.push(
        ...(await scanImports(file, ({ module }) =>
          forbiddenImport(file, module.text, appNames) ? `import into apps/: ${module.text}` : null
        ))
      )
    }
  }

  for (const file of await walk(SIM_DIR).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return []
    throw error
  })) {
    if (!path.relative(ROOT, file).split(path.sep).includes('application') || TEST_FILE.test(file))
      continue
    offenders.push(
      ...(await scanImports(file, ({ module, bindings }) =>
        applicationViolation(aliasedSpecifier(file, module.text), bindings)
      ))
    )
  }

  for (const file of await sourceFiles(PLATFORM_LIB_DIR)) {
    offenders.push(
      ...(await scanImports(file, ({ module }) => {
        const specifier = aliasedSpecifier(file, module.text)
        return matchesModule(specifier, '@/platform/app')
          ? `platform/lib imports a view: ${specifier}`
          : null
      }))
    )
  }

  const viewSeamHits: Offender[] = []
  for (const file of await sourceFiles(PLATFORM_VIEWS_DIR)) {
    viewSeamHits.push(
      ...(await scanImports(file, ({ module, bindings }) =>
        viewSeamViolation(aliasedSpecifier(file, module.text), bindings)
      ))
    )
  }
  const baseline = readViewSeamBaseline()
  const { counts, raised, dropped } = viewSeamFailures(baseline, viewSeamHits)

  if (process.argv.includes('--update')) {
    const refused = updateViewSeamBaseline(baseline, counts)
    if (refused.length > 0) {
      for (const reason of refused) console.error(`❌ ${reason}`)
      process.exit(1)
    }
    console.log(`Wrote the view seam baseline: ${viewSeamHits.length} edges`)
    return
  }

  const violations = [...offenders, ...raised]
  if (violations.length === 0 && dropped.length === 0) {
    console.log(
      `✅ Monorepo boundaries OK: no package imports from apps/*, application code is surface-neutral, and platform/lib points away from its views (${viewSeamHits.length} view edges baselined)`
    )
    return
  }

  if (violations.length > 0) {
    console.error('❌ Monorepo boundary violations found:')
    for (const offender of violations) {
      console.error(
        `  ${offender.file}:${offender.line} — ${offender.description}\n    ${offender.snippet}`
      )
    }
  }
  if (dropped.length > 0) {
    console.error('❌ View seam edges fell below the baseline; shrink it with --update:')
    for (const line of dropped) console.error(`  ${line}`)
  }
  process.exit(1)
}

void main().catch((error) => {
  console.error('Monorepo boundary check failed:', error)
  process.exit(1)
})
