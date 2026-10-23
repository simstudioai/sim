#!/usr/bin/env bun
/**
 * Fails if a route's exported HTTP-verb symbol disagrees with the `method` (or
 * `path`) of the contract it is built from.
 *
 * All five declarative route builders — `defineV2JsonRoute`,
 * `defineV2BinaryRoute`, `defineV2BodyLifecycleRoute`, `defineInternalJsonRoute`
 * and `defineInternalBinaryRoute` — throw when `request.method` is not the one
 * `contract.method` declares, `methodMatchesContract` allowing only a `HEAD`
 * request against a `GET` contract. That check only fires at RUNTIME, on a real
 * request, and Next.js routes purely by the exported symbol name. So a
 * half-finished rename — `export const PUT` still holding a contract
 * that declares `PATCH` — produces a 500 on the verb clients actually call and
 * a 405 on the one they do not, while type-check, tests and every existing
 * audit stay green. The mismatch is invisible until production traffic hits it.
 *
 * The same reasoning applies to `contract.path`: a route wired to a
 * structurally-valid but wrong contract (copy-paste from a sibling resource)
 * type-checks fine, and every builder-derived behaviour — rate-limit keys,
 * audit records, OpenAPI output — then describes the wrong endpoint. The URL a
 * route actually serves is its directory, so the contract's `path` must equal
 * the directory path with Next route-group segments (`(group)`) stripped.
 *
 * Guard shape:
 *   1. Statically scan every `apps/sim/app/api/**\/route.ts` for
 *      `export const <VERB> = define…Route({` and the `contract:` key inside it.
 *   2. Resolve the contract identifier through the route file's own `import`
 *      statement, then `await import()` the CONTRACT module only. Contract
 *      modules are pure Zod; the route module is never imported, because doing
 *      so drags in `@sim/db`, auth and `next/server` side effects.
 *   3. Compare the exported verb symbol to `contract.method`, and the derived
 *      URL to `contract.path`.
 *
 * Raw `withRouteHandler(...)` routes — the documented protocol/lifecycle
 * exceptions for streaming, multipart control, large-body admission, OAuth and
 * public execution — have no `contract:` key, but most still validate with
 * `parseRequest(<contract>, …)`. Every `parseRequest` call reachable from an
 * exported verb (directly, or through a same-file function or const it names)
 * is checked the same way. The mismatch is just as silent there: `parseRequest`
 * never reads a body for a `GET` contract, and `requestJson` sends the
 * contract's verb, so clients get a 405.
 *
 * Nothing is skipped silently. A builder call site whose contract cannot be
 * located, resolved, imported or read fails the build exactly like a mismatch:
 * a guard that quietly ignores what it cannot parse guards nothing. The same
 * holds for a raw route's `parseRequest` argument imported from
 * `@/lib/api/contracts`. A raw route whose argument is a local value or comes
 * from any other module is out of scope: resolving it would mean importing
 * server code.
 *
 * Usage:
 *   bun run scripts/check-route-verbs.ts
 *   bun run scripts/check-route-verbs.ts --verbose   # print every checked site
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from '@babel/parser'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const APP = path.join(ROOT, 'apps/sim')
const API_DIR = path.join(APP, 'app/api')

/** Verb symbols Next.js recognises as route handlers. */
const VERBS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const

/** The declarative builders that bind a route to a contract. */
const BUILDERS = [
  'defineV2JsonRoute',
  'defineV2BinaryRoute',
  'defineV2BodyLifecycleRoute',
  'defineInternalJsonRoute',
  'defineInternalBinaryRoute',
  'defineScimRoute',
] as const

const BUILDER_ALT = BUILDERS.join('|')

/**
 * `export const GET = defineInternalJsonRoute({` — the optional `<…>` covers
 * explicitly-parameterised builder calls, and the optional `: Type` covers an
 * annotated export.
 */
const EXPORT_RE = new RegExp(
  `export const (${VERBS.join('|')})\\s*(?::[^=]+)?=\\s*(${BUILDER_ALT})\\s*(?:<[^(]*>)?\\(\\{`,
  'g'
)

/** Any builder invocation, used to prove the export scan missed nothing. */
const BUILDER_CALL_RE = new RegExp(`\\b(?:${BUILDER_ALT})\\s*(?:<[^(]*>)?\\(`, 'g')

/** The `contract:` key at the top level of the builder's options object. */
const CONTRACT_KEY_RE = /\n\s{2}contract:\s*([A-Za-z0-9_$]+)\s*,/

/** How far past the builder's `({` to look for the `contract:` key. */
const OPTIONS_SCAN_CHARS = 4000

type Statements = ReturnType<typeof parse>['program']['body']

function isVerb(name: string): boolean {
  return VERBS.some((verb) => verb === name)
}

/**
 * A module's top-level functions and variables (name -> body or initialiser),
 * and every local export as `{ exported, local }` — both an inline
 * `export const GET = …` and an export list such as `export { handler as GET }`.
 * A re-export from another module (`export { GET } from '…'`) binds no local
 * and is left out.
 */
function topLevelBindings(statements: Statements): {
  locals: Map<string, unknown>
  exports: Array<{ exported: string; local: string }>
} {
  const locals = new Map<string, unknown>()
  const exports: Array<{ exported: string; local: string }> = []
  for (const statement of statements) {
    const isExport = statement.type === 'ExportNamedDeclaration'
    if (isExport && !statement.declaration && !statement.source) {
      for (const specifier of statement.specifiers) {
        if (specifier.type !== 'ExportSpecifier') continue
        const exported =
          specifier.exported.type === 'Identifier'
            ? specifier.exported.name
            : specifier.exported.value
        exports.push({ exported, local: specifier.local.name })
      }
      continue
    }
    const declaration = isExport ? statement.declaration : statement
    const named: Array<[string, unknown]> = []
    if (declaration?.type === 'FunctionDeclaration' && declaration.id) {
      named.push([declaration.id.name, declaration.body])
    } else if (declaration?.type === 'VariableDeclaration') {
      for (const declarator of declaration.declarations) {
        if (declarator.id.type === 'Identifier' && declarator.init) {
          named.push([declarator.id.name, declarator.init])
        }
      }
    }
    for (const [name, root] of named) {
      locals.set(name, root)
      if (isExport) exports.push({ exported: name, local: name })
    }
  }
  return { locals, exports }
}

/** Resolves exported handler references and tracing callbacks without importing server code. */
export function wrappedRouteSites(
  source: string
): Array<{ verb: string; builder: string; optionsStart: number }> {
  const statements = parse(source, { sourceType: 'module', plugins: ['typescript'] }).program.body
  const handlers = new Map<string, { builder: string; optionsStart: number }>()
  for (const statement of statements) {
    if (statement.type !== 'VariableDeclaration' || statement.kind !== 'const') continue
    for (const declaration of statement.declarations) {
      const call = declaration.init
      if (declaration.id.type !== 'Identifier' || call?.type !== 'CallExpression') continue
      if (call.callee.type !== 'Identifier' || !BUILDERS.some((name) => name === call.callee.name))
        continue
      const options = call.arguments[0]
      if (options?.type === 'ObjectExpression' && typeof options.start === 'number') {
        handlers.set(declaration.id.name, {
          builder: call.callee.name,
          optionsStart: options.start + 1,
        })
      }
    }
  }
  const { locals, exports } = topLevelBindings(statements)
  const sites: Array<{ verb: string; builder: string; optionsStart: number }> = []
  for (const { exported: verb, local } of exports) {
    if (!isVerb(verb)) continue
    const found = new Set<{ builder: string; optionsStart: number }>()
    const direct = handlers.get(local)
    if (direct !== undefined) found.add(direct)
    const visit = (value: unknown): void => {
      if (!value || typeof value !== 'object') return
      if (Array.isArray(value)) {
        value.forEach(visit)
        return
      }
      const node = value as Record<string, unknown>
      if (node.type === 'Identifier' && typeof node.name === 'string') {
        const handler = handlers.get(node.name)
        if (handler !== undefined) found.add(handler)
      }
      Object.values(node).forEach(visit)
    }
    if (direct === undefined) visit(locals.get(local))
    for (const handler of found) sites.push({ verb, ...handler })
  }
  return sites
}

/** Modules that export the server-side `parseRequest`. */
const PARSE_REQUEST_MODULES = new Set(['@/lib/api/server', '@/lib/api/server/validation'])

/**
 * Local names a module binds to `parseRequest`: `parseRequest` itself, plus
 * each alias of an `import { parseRequest as … }` from its real module.
 */
function parseRequestNames(statements: Statements): Set<string> {
  const names = new Set(['parseRequest'])
  for (const statement of statements) {
    if (statement.type !== 'ImportDeclaration') continue
    if (!PARSE_REQUEST_MODULES.has(statement.source.value)) continue
    for (const specifier of statement.specifiers) {
      if (specifier.type !== 'ImportSpecifier') continue
      const imported =
        specifier.imported.type === 'Identifier'
          ? specifier.imported.name
          : specifier.imported.value
      if (imported === 'parseRequest') names.add(specifier.local.name)
    }
  }
  return names
}

/**
 * The `parseRequest(<identifier>, …)` contract arguments reachable from each
 * exported verb of a raw route, following same-file functions and consts the
 * verb's handler names. Another exported verb is not followed: an alias such as
 * `PUT` forwarding to `PATCH` is checked as `PATCH`. A non-identifier argument
 * is not a resolvable contract and is left out.
 */
export function rawRouteContractSites(source: string): Array<{ verb: string; identifier: string }> {
  const statements = parse(source, { sourceType: 'module', plugins: ['typescript'] }).program.body
  const { locals, exports } = topLevelBindings(statements)
  const parsers = parseRequestNames(statements)
  const verbLocals = new Set(
    exports.filter(({ exported }) => isVerb(exported)).map(({ local }) => local)
  )
  const sites: Array<{ verb: string; identifier: string }> = []
  for (const { exported: verb, local } of exports) {
    if (!isVerb(verb)) continue
    const identifiers = new Set<string>()
    const followed = new Set(verbLocals)
    const visit = (value: unknown): void => {
      if (!value || typeof value !== 'object') return
      if (Array.isArray(value)) {
        value.forEach(visit)
        return
      }
      const node = value as Record<string, unknown>
      if (node.type === 'CallExpression') {
        const callee = node.callee as { type?: string; name?: string }
        const [first] = node.arguments as Array<{ type?: string; name?: string }>
        if (
          callee.type === 'Identifier' &&
          callee.name !== undefined &&
          parsers.has(callee.name) &&
          first?.type === 'Identifier' &&
          first.name
        ) {
          identifiers.add(first.name)
        }
      }
      if (node.type === 'Identifier' && typeof node.name === 'string') {
        const local = locals.get(node.name)
        if (local !== undefined && !followed.has(node.name)) {
          followed.add(node.name)
          visit(local)
        }
      }
      if (node.type === 'MemberExpression' && !node.computed) {
        visit(node.object)
        return
      }
      if (node.type === 'ObjectProperty' && !node.computed) {
        visit(node.value)
        return
      }
      Object.values(node).forEach(visit)
    }
    visit(locals.get(local))
    for (const identifier of identifiers) sites.push({ verb, identifier })
  }
  return sites
}

interface RouteContract {
  method?: unknown
  path?: unknown
}

function listRouteFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) listRouteFiles(full, found)
    else if (entry.name === 'route.ts') found.push(full)
  }
  return found
}

/** Where an imported local binding comes from: its module and the name that module exports it as. */
interface ImportedBinding {
  specifier: string
  exported: string
}

/** Local binding name -> its source module and exported name, from the file's import statements. */
export function importedNames(source: string): Map<string, ImportedBinding> {
  const bindings = new Map<string, ImportedBinding>()
  for (const match of source.matchAll(
    /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['"]([^'"]+)['"]/g
  )) {
    for (const raw of match[1].split(',')) {
      const clause = raw.trim().replace(/^type\s+/, '')
      if (!clause) continue
      const [original, alias] = clause.split(/\s+as\s+/).map((part) => part.trim())
      bindings.set(alias ?? original, { specifier: match[2], exported: original })
    }
  }
  return bindings
}

/** Resolves an `@/`-aliased specifier to a file on disk, honouring barrels. */
function resolveContractModule(specifier: string): string | null {
  if (!specifier.startsWith('@/')) return null
  const base = path.join(APP, specifier.slice(2))
  for (const candidate of [`${base}.ts`, path.join(base, 'index.ts')]) {
    if (existsSync(candidate)) return candidate
  }
  return null
}

const moduleCache = new Map<string, Promise<Record<string, unknown>>>()

function loadContractModule(file: string): Promise<Record<string, unknown>> {
  let loaded = moduleCache.get(file)
  if (!loaded) {
    loaded = import(file) as Promise<Record<string, unknown>>
    moduleCache.set(file, loaded)
  }
  return loaded
}

/** Resolves and imports a contract module; null when the specifier resolves to no file. */
type ContractModuleLoader = (specifier: string) => Promise<Record<string, unknown>> | null

const loadContractSpecifier: ContractModuleLoader = (specifier) => {
  const modulePath = resolveContractModule(specifier)
  return modulePath ? loadContractModule(modulePath) : null
}

/** The URL Next.js actually serves this file at: its directory, minus route groups. */
function derivedPath(file: string): string {
  const segments = path
    .relative(API_DIR, path.dirname(file))
    .split(path.sep)
    .filter((segment) => segment.length > 0 && !(segment.startsWith('(') && segment.endsWith(')')))
  return ['/api', ...segments].join('/')
}

/**
 * Where a contract identifier is bound in a route: a builder's `contract:` key or a raw
 * `parseRequest`. `scim` is `defineScimRoute`, the one builder that rejects a `HEAD` request
 * against a `GET` contract instead of serving it through `methodMatchesContract`.
 */
type SiteKind = 'builder' | 'scim' | 'raw'

/** One route file, as every site in it is checked against. */
interface RouteFile {
  relative: string
  /** Local binding name -> its source module and exported name. */
  bindings: Map<string, ImportedBinding>
  /** The URL the file serves. */
  expectedPath: string
}

/**
 * Whether a route serves `contractPath`. A raw catch-all route (`[...slug]`,
 * `[[...slug]]`) dispatches sub-paths itself, so any contract under its prefix
 * is one it serves.
 */
function servesPath(kind: SiteKind, expectedPath: string, contractPath: string): boolean {
  if (contractPath === expectedPath) return true
  const catchAll = expectedPath.search(/\/\[{1,2}\.\.\./)
  return (
    kind === 'raw' &&
    catchAll !== -1 &&
    contractPath.startsWith(expectedPath.slice(0, catchAll + 1))
  )
}

/**
 * Resolves `identifier` through the route's imports and compares the contract to
 * the exported verb and the path the file serves, pushing every disagreement to
 * `failures`. Returns whether a contract was compared: false for a site that
 * could not be resolved (a failure) or a raw route's non-contract argument (out
 * of scope).
 */
export async function checkSite(
  route: RouteFile,
  kind: SiteKind,
  verb: string,
  identifier: string,
  failures: string[],
  verbose: boolean,
  loadModule: ContractModuleLoader = loadContractSpecifier
): Promise<boolean> {
  const { relative, bindings, expectedPath } = route
  const binding = bindings.get(identifier)
  if (kind === 'raw' && !binding?.specifier.startsWith('@/lib/api/contracts')) return false
  if (!binding) {
    failures.push(`${relative}: export const ${verb} uses \`${identifier}\`, which is not imported`)
    return false
  }
  const { specifier, exported } = binding

  const loading = loadModule(specifier)
  if (!loading) {
    failures.push(
      `${relative}: export const ${verb} imports \`${identifier}\` from '${specifier}', which does not resolve to a contract module`
    )
    return false
  }

  let module: Record<string, unknown>
  try {
    module = await loading
  } catch (error) {
    failures.push(
      `${relative}: export const ${verb} — importing '${specifier}' failed: ${(error as Error).message}`
    )
    return false
  }

  const contract = module[exported] as RouteContract | undefined
  if (typeof contract?.method !== 'string' || typeof contract?.path !== 'string') {
    failures.push(
      `${relative}: export const ${verb} — \`${identifier}\` from '${specifier}' is not a route contract (no string \`method\`/\`path\`)`
    )
    return false
  }

  const subject =
    kind !== 'raw'
      ? `export const ${verb} is built from \`${identifier}\``
      : `export const ${verb} parses with \`${identifier}\``
  const method = contract.method.toUpperCase()
  if (method !== verb && !(verb === 'HEAD' && method === 'GET' && kind !== 'scim')) {
    failures.push(
      kind !== 'raw'
        ? `${relative}: ${subject}, which declares ${contract.method} ${contract.path}. Next routes by the exported symbol, so ${verb} requests 500 and ${contract.method} requests 404.`
        : `${relative}: ${subject}, which declares ${contract.method} ${contract.path}. Clients calling through the contract send ${contract.method} and get a 405.`
    )
  }
  if (!servesPath(kind, expectedPath, contract.path)) {
    failures.push(
      `${relative}: ${subject}, whose path is ${contract.path}, but this file serves ${expectedPath}.`
    )
  }
  if (verbose) {
    console.log(
      `✓ ${relative} ${verb} ← ${identifier} (${kind}, ${contract.method} ${contract.path})`
    )
  }
  return true
}

async function main() {
  const verbose = process.argv.includes('--verbose')

  if (!existsSync(API_DIR)) {
    console.error(`❌ ${path.relative(ROOT, API_DIR)} does not exist — update API_DIR.`)
    process.exit(1)
  }

  const failures: string[] = []
  let checked = 0
  let files = 0
  let rawChecked = 0
  let rawFiles = 0

  for (const file of listRouteFiles(API_DIR).sort()) {
    const source = readFileSync(file, 'utf8')
    const relative = path.relative(ROOT, file)
    const route: RouteFile = {
      relative,
      bindings: importedNames(source),
      expectedPath: derivedPath(file),
    }

    if (source.includes('parseRequest')) {
      let rawSitesInFile = 0
      for (const { verb, identifier } of rawRouteContractSites(source)) {
        if (await checkSite(route, 'raw', verb, identifier, failures, verbose)) rawSitesInFile += 1
      }
      if (rawSitesInFile > 0) {
        rawChecked += rawSitesInFile
        rawFiles += 1
      }
    }

    let builderCalls = 0
    for (const _ of source.matchAll(BUILDER_CALL_RE)) builderCalls += 1
    if (builderCalls === 0) continue

    files += 1
    let sitesInFile = 0

    const directSites = [...source.matchAll(EXPORT_RE)].map((match) => ({
      verb: match[1],
      builder: match[2],
      optionsStart: (match.index ?? 0) + match[0].length,
    }))
    const sites =
      directSites.length === builderCalls
        ? directSites
        : [...directSites, ...wrappedRouteSites(source)]
    for (const { verb, builder, optionsStart } of sites) {
      sitesInFile += 1
      const options = source.slice(optionsStart, optionsStart + OPTIONS_SCAN_CHARS)

      const contractKey = options.match(CONTRACT_KEY_RE)
      if (!contractKey) {
        failures.push(`${relative}: export const ${verb} has no top-level \`contract:\` key`)
        continue
      }
      const identifier = contractKey[1]
      const kind = builder === 'defineScimRoute' ? 'scim' : 'builder'
      if (await checkSite(route, kind, verb, identifier, failures, verbose)) checked += 1
    }

    if (sitesInFile < builderCalls) {
      failures.push(
        `${relative}: found ${builderCalls} builder call(s) but only matched ${sitesInFile} \`export const <VERB> = …\` site(s). The scan cannot see this route's verb binding — update EXPORT_RE rather than leaving it unchecked.`
      )
    }
  }

  if (checked === 0 || rawChecked === 0) {
    console.error(
      '❌ No builder-backed or no raw parseRequest route handlers found. Refusing to pass vacuously — the scan patterns are stale.'
    )
    process.exit(1)
  }

  if (failures.length > 0) {
    console.error(`\n❌ ${failures.length} route/contract disagreement(s):\n`)
    for (const failure of failures) console.error(`  ${failure}`)
    console.error(
      '\nThe builders only compare request.method to contract.method at runtime, and raw'
    )
    console.error('routes never do, so these fail in production rather than at build time. Fix the')
    console.error('export symbol or point the route at the right contract.')
    process.exit(1)
  }

  console.log(
    `✓ ${checked} builder-backed route handler(s) across ${files} file(s) and ${rawChecked} raw parseRequest site(s) across ${rawFiles} file(s) match their contract's method and path`
  )
}

if (import.meta.main) await main()
