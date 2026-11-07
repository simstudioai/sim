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
 * 3. The organization surface's seam points one way, in both data layers. `apps/sim/platform/embedded/lib`
 *    never imports `@/platform/embedded/app` or `@/app/o`, not even for a type, and
 *    `apps/sim/platform/lib` never imports `@/app/o`, not even for a type, or `@/platform/app` at
 *    runtime: views depend on the data layer, routes depend on both, and a data file that reached
 *    back into either could not be read or tested without it. Fix by moving what both need under
 *    the data layer, or under `lib/` when a surface the design system may not reach (the extension,
 *    `/workspace`) shares it.
 * 4. Views (`apps/sim/platform/embedded/app`) read data through `platform/embedded/lib/data`, so a read gets one
 *    adaptation and one place to fix it: no runtime edge to a data hook, in `@/hooks/queries` or
 *    a `hooks` folder under `@/ee`. Domain primitives elsewhere in `@/ee` (`lib`, constants,
 *    labels) are not data, and views import them directly. Fix with a data file that adapts the
 *    read. A file that only re-exports a hook satisfies this rule on paper and fixes nothing, so
 *    do not add one.
 *
 * 5. The rest of `apps/sim/platform` does not import `@/app/o`, not even for a type: routes adapt
 *    Platform, so an edge the other way is a cycle through a route folder.
 * 6. `apps/sim/platform/embedded/lib` does not import `@/app/workspace`, not even for a type: the data layer
 *    would inherit that surface's components and hooks. Fix by moving the shared part under `lib/`
 *    or `hooks/`.
 *
 * 7. The Platform zone and the organization views are two apps sharing `platform/design-system`. Nothing
 *    under `apps/sim/platform` outside `embedded` imports `@/platform/embedded`, and `embedded` imports
 *    nothing under `@/platform` but itself, the design system and `platform/shared`, tests included: the views are built on
 *    the host app, so an edge from the zone would pull the host into a separate build, and an edge
 *    the other way would make the zone part of what every organization ships.
 *
 * 8. Views (`apps/sim/platform/embedded/app`) do not import `@/app/workspace`, not even for a type: each
 *    edge is legacy code that a design-system view cannot be restyled without. Fix by moving the
 *    shared part under `lib/` or `hooks/`.
 * 9. `apps/sim/platform/lib` takes the view models it fills from the views, by type. That makes rule 3
 *    hold only at runtime for this layer. Fix by moving the model under `platform/lib/data`.
 *
 * Rules 1 to 3 and 7 have no allowlist. Rules 4 to 6, 8 and 9 predate their enforcement, so their existing edges
 * are counted per file in `scripts/check-monorepo-boundaries.baseline.json`, one section per rule. A
 * file above its count fails, and so does one below it until the baseline is rewritten, so the
 * baseline only shrinks. Regenerate after removing edges with `--update`, which refuses to raise a
 * count; `--update --init` only creates a missing baseline.
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
const PLATFORM_DIR = path.join(SIM_DIR, 'platform')
const ZONE_LIB_DIR = path.join(PLATFORM_DIR, 'lib')
const PLATFORM_LIB_DIR = path.join(PLATFORM_DIR, 'embedded/lib')
const PLATFORM_VIEWS_DIR = path.join(SIM_DIR, 'platform/embedded/app')
const EMBEDDED_DIR = path.join(PLATFORM_DIR, 'embedded')
const EE_DATA_HOOK = /^@\/ee\/(?:.+\/)?hooks(?:\/|$)/
const SEAM_BASELINE = path.join(ROOT, 'scripts/check-monorepo-boundaries.baseline.json')

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
    return `view reads a data hook around platform/embedded/lib/data: ${specifier}`
  }
  return null
}

/** Why a file under `apps/sim/platform` may not take this edge across the zone/embedded line. */
function zoneEmbeddedViolation(file: string, specifier: string): string | null {
  if (!file.startsWith(`${EMBEDDED_DIR}${path.sep}`)) {
    return matchesModule(specifier, '@/platform/embedded')
      ? `the Platform zone imports the organization views: ${specifier}`
      : null
  }
  if (
    !specifier.startsWith('@/platform/') ||
    matchesModule(specifier, '@/platform/embedded') ||
    matchesModule(specifier, '@/platform/design-system') ||
    matchesModule(specifier, '@/platform/shared')
  ) {
    return null
  }
  return `the organization views import the Platform zone: ${specifier}`
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

/** Every file under `dir`; a directory that does not exist has none. */
async function allFiles(dir: string): Promise<string[]> {
  return walk(dir).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return []
    throw error
  })
}

/** Every file under `dir` but tests. */
async function sourceFiles(dir: string): Promise<string[]> {
  return (await allFiles(dir)).filter((file) => !TEST_FILE.test(file))
}

const SEAM_RATCHETS = [
  'viewDataHooks',
  'platformToRoutes',
  'platformLibToWorkspace',
  'viewsToWorkspace',
  'zoneLibToViewTypes',
] as const

type SeamRatchet = (typeof SEAM_RATCHETS)[number]
type SeamCounts = Record<string, number>
type SeamBaseline = Record<SeamRatchet, SeamCounts>

function readSeamBaseline(): SeamBaseline | null {
  if (!existsSync(SEAM_BASELINE)) return null
  return JSON.parse(readFileSync(SEAM_BASELINE, 'utf8')) as SeamBaseline
}

function writeSeamBaseline(counts: SeamBaseline): void {
  const sorted = Object.fromEntries(
    SEAM_RATCHETS.map((ratchet) => [
      ratchet,
      Object.fromEntries(
        Object.entries(counts[ratchet]).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      ),
    ])
  )
  writeFileSync(SEAM_BASELINE, `${JSON.stringify(sorted, null, 2)}\n`)
}

/** Rewrites the baseline, or returns why it may not: a count only ever falls. */
function updateSeamBaseline(baseline: SeamBaseline | null, counts: SeamBaseline): string[] {
  if (baseline === null) {
    if (!process.argv.includes('--init')) {
      return ['the seam baseline is missing: restore it, or create one with --update --init']
    }
    writeSeamBaseline(counts)
    return []
  }
  const refused = SEAM_RATCHETS.flatMap((ratchet) =>
    Object.entries(counts[ratchet]).flatMap(([file, count]) => {
      const allowed = baseline[ratchet]?.[file] ?? 0
      return count > allowed
        ? [`refused to raise ${ratchet} ${file}: ${count} (baseline ${allowed}); fix it instead`]
        : []
    })
  )
  if (refused.length === 0) writeSeamBaseline(counts)
  return refused
}

/** Files past their count, each with its edges, and baselined files now below it. */
function seamFailures(allowed: SeamCounts, hits: readonly Offender[]) {
  const counts: SeamCounts = {}
  for (const hit of hits) counts[hit.file] = (counts[hit.file] ?? 0) + 1
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

  const seamHits: Record<SeamRatchet, Offender[]> = {
    viewDataHooks: [],
    platformToRoutes: [],
    platformLibToWorkspace: [],
    viewsToWorkspace: [],
    zoneLibToViewTypes: [],
  }

  const platformLibFiles = await sourceFiles(PLATFORM_LIB_DIR)
  const platformLibFileSet = new Set(platformLibFiles)
  for (const file of platformLibFiles) {
    offenders.push(
      ...(await scanImports(file, ({ module }) => {
        const specifier = aliasedSpecifier(file, module.text)
        if (matchesModule(specifier, '@/platform/embedded/app')) {
          return `platform/embedded/lib imports a view: ${specifier}`
        }
        return matchesModule(specifier, '@/app/o')
          ? `platform/embedded/lib imports a route: ${specifier}`
          : null
      }))
    )
    seamHits.platformLibToWorkspace.push(
      ...(await scanImports(file, ({ module }) => {
        const specifier = aliasedSpecifier(file, module.text)
        return matchesModule(specifier, '@/app/workspace')
          ? `platform/embedded/lib imports the workspace surface: ${specifier}`
          : null
      }))
    )
  }

  const zoneLibFiles = await sourceFiles(ZONE_LIB_DIR)
  for (const file of zoneLibFiles) {
    offenders.push(
      ...(await scanImports(file, ({ module, bindings }) => {
        const specifier = aliasedSpecifier(file, module.text)
        if (matchesModule(specifier, '@/app/o')) return `platform/lib imports a route: ${specifier}`
        const runtime = bindings === 'all' || bindings.length > 0
        return runtime && matchesModule(specifier, '@/platform/app')
          ? `platform/lib imports a view at runtime: ${specifier}`
          : null
      }))
    )
    seamHits.zoneLibToViewTypes.push(
      ...(await scanImports(file, ({ module, bindings }) => {
        const specifier = aliasedSpecifier(file, module.text)
        const typeOnly = bindings !== 'all' && bindings.length === 0
        return typeOnly && matchesModule(specifier, '@/platform/app')
          ? `platform/lib takes a view's type: ${specifier}`
          : null
      }))
    )
  }

  for (const file of await allFiles(PLATFORM_DIR)) {
    offenders.push(
      ...(await scanImports(file, ({ module }) =>
        zoneEmbeddedViolation(file, aliasedSpecifier(file, module.text))
      ))
    )
  }

  const zoneLibFileSet = new Set(zoneLibFiles)
  for (const file of await sourceFiles(PLATFORM_DIR)) {
    if (platformLibFileSet.has(file) || zoneLibFileSet.has(file)) continue
    seamHits.platformToRoutes.push(
      ...(await scanImports(file, ({ module }) => {
        const specifier = aliasedSpecifier(file, module.text)
        return matchesModule(specifier, '@/app/o') ? `platform imports a route: ${specifier}` : null
      }))
    )
  }

  for (const file of await sourceFiles(PLATFORM_VIEWS_DIR)) {
    seamHits.viewDataHooks.push(
      ...(await scanImports(file, ({ module, bindings }) =>
        viewSeamViolation(aliasedSpecifier(file, module.text), bindings)
      ))
    )
    seamHits.viewsToWorkspace.push(
      ...(await scanImports(file, ({ module }) => {
        const specifier = aliasedSpecifier(file, module.text)
        return matchesModule(specifier, '@/app/workspace')
          ? `view imports the workspace surface: ${specifier}`
          : null
      }))
    )
  }

  const baseline = readSeamBaseline()
  const results = SEAM_RATCHETS.map((ratchet) => ({
    ratchet,
    ...seamFailures(baseline?.[ratchet] ?? {}, seamHits[ratchet]),
  }))
  const edgeCount = SEAM_RATCHETS.reduce((total, ratchet) => total + seamHits[ratchet].length, 0)

  if (process.argv.includes('--update')) {
    const counts = Object.fromEntries(
      results.map(({ ratchet, counts }) => [ratchet, counts])
    ) as SeamBaseline
    const refused = updateSeamBaseline(baseline, counts)
    if (refused.length > 0) {
      for (const reason of refused) console.error(`❌ ${reason}`)
      process.exit(1)
    }
    console.log(`Wrote the seam baseline: ${edgeCount} edges`)
    return
  }

  const violations = [...offenders, ...results.flatMap(({ raised }) => raised)]
  const dropped = results.flatMap(({ ratchet, dropped }) =>
    dropped.map((line) => `${ratchet} ${line}`)
  )
  if (violations.length === 0 && dropped.length === 0) {
    console.log(
      `✅ Monorepo boundaries OK: no package imports from apps/*, application code is surface-neutral, the zone and the organization views stay apart, and both data layers point away from views and routes (${edgeCount} seam edges baselined)`
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
    console.error('❌ Seam edges fell below the baseline; shrink it with --update:')
    for (const line of dropped) console.error(`  ${line}`)
  }
  process.exit(1)
}

void main().catch((error) => {
  console.error('Monorepo boundary check failed:', error)
  process.exit(1)
})
