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
 * Known, intentional limitation: routes written as raw `withRouteHandler(...)`
 * — the documented protocol/lifecycle exceptions for streaming, multipart
 * control, large-body admission, OAuth and public execution — have no
 * `contract:` key and are deliberately out of scope. They are excluded by
 * requiring a builder call, not by an allowlist.
 *
 * Nothing is skipped silently. A builder call site whose contract cannot be
 * located, resolved, imported or read fails the build exactly like a mismatch:
 * a guard that quietly ignores what it cannot parse guards nothing.
 *
 * Usage:
 *   bun run scripts/check-route-verbs.ts
 *   bun run scripts/check-route-verbs.ts --verbose   # print every checked site
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dir, '..')
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

/** Local binding name -> module specifier, from the file's import statements. */
function importedNames(source: string): Map<string, string> {
  const bindings = new Map<string, string>()
  for (const match of source.matchAll(
    /import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['"]([^'"]+)['"]/g
  )) {
    for (const raw of match[1].split(',')) {
      const clause = raw.trim().replace(/^type\s+/, '')
      if (!clause) continue
      const [original, alias] = clause.split(/\s+as\s+/).map((part) => part.trim())
      bindings.set(alias ?? original, match[2])
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

/** The URL Next.js actually serves this file at: its directory, minus route groups. */
function derivedPath(file: string): string {
  const segments = path
    .relative(API_DIR, path.dirname(file))
    .split(path.sep)
    .filter((segment) => segment.length > 0 && !(segment.startsWith('(') && segment.endsWith(')')))
  return ['/api', ...segments].join('/')
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

  for (const file of listRouteFiles(API_DIR).sort()) {
    const source = readFileSync(file, 'utf8')
    let builderCalls = 0
    for (const _ of source.matchAll(BUILDER_CALL_RE)) builderCalls += 1
    if (builderCalls === 0) continue

    files += 1
    const relative = path.relative(ROOT, file)
    const bindings = importedNames(source)
    const expectedPath = derivedPath(file)
    let sitesInFile = 0

    for (const match of source.matchAll(EXPORT_RE)) {
      sitesInFile += 1
      const verb = match[1]
      const optionsStart = (match.index ?? 0) + match[0].length
      const options = source.slice(optionsStart, optionsStart + OPTIONS_SCAN_CHARS)

      const contractKey = options.match(CONTRACT_KEY_RE)
      if (!contractKey) {
        failures.push(`${relative}: export const ${verb} has no top-level \`contract:\` key`)
        continue
      }
      const identifier = contractKey[1]

      const specifier = bindings.get(identifier)
      if (!specifier) {
        failures.push(
          `${relative}: export const ${verb} uses \`${identifier}\`, which is not imported`
        )
        continue
      }

      const modulePath = resolveContractModule(specifier)
      if (!modulePath) {
        failures.push(
          `${relative}: export const ${verb} imports \`${identifier}\` from '${specifier}', which does not resolve to a contract module`
        )
        continue
      }

      let module: Record<string, unknown>
      try {
        module = await loadContractModule(modulePath)
      } catch (error) {
        failures.push(
          `${relative}: export const ${verb} — importing '${specifier}' failed: ${(error as Error).message}`
        )
        continue
      }

      const contract = module[identifier] as RouteContract | undefined
      if (typeof contract?.method !== 'string' || typeof contract?.path !== 'string') {
        failures.push(
          `${relative}: export const ${verb} — \`${identifier}\` from '${specifier}' is not a route contract (no string \`method\`/\`path\`)`
        )
        continue
      }

      checked += 1

      if (contract.method.toUpperCase() !== verb) {
        failures.push(
          `${relative}: export const ${verb} is built from \`${identifier}\`, which declares ${contract.method} ${contract.path}. Next routes by the exported symbol, so ${verb} requests 500 and ${contract.method} requests 404.`
        )
      }
      if (contract.path !== expectedPath) {
        failures.push(
          `${relative}: export const ${verb} is built from \`${identifier}\`, whose path is ${contract.path}, but this file serves ${expectedPath}.`
        )
      }
      if (verbose) {
        console.log(`✓ ${relative} ${verb} ← ${identifier} (${contract.method} ${contract.path})`)
      }
    }

    if (sitesInFile < builderCalls) {
      failures.push(
        `${relative}: found ${builderCalls} builder call(s) but only matched ${sitesInFile} \`export const <VERB> = …\` site(s). The scan cannot see this route's verb binding — update EXPORT_RE rather than leaving it unchecked.`
      )
    }
  }

  if (checked === 0) {
    console.error(
      '❌ No builder-backed route handlers found. Refusing to pass vacuously — the scan patterns are stale.'
    )
    process.exit(1)
  }

  if (failures.length > 0) {
    console.error(`\n❌ ${failures.length} route/contract disagreement(s):\n`)
    for (const failure of failures) console.error(`  ${failure}`)
    console.error(
      '\nThe builders only compare request.method to contract.method at runtime, so these'
    )
    console.error('fail as 500s in production rather than at build time. Fix the export symbol or')
    console.error('point the route at the right contract.')
    process.exit(1)
  }

  console.log(
    `✓ ${checked} builder-backed route handler(s) across ${files} file(s) match their contract's method and path`
  )
}

await main()
