#!/usr/bin/env bun
/**
 * Fails when a route contract declares a `method` on a `path` whose route file
 * exists but does not export that method.
 *
 * Contracts are consumed in two modes (see `ApiRouteContract`). A boundary
 * contract is served by a route under `app/api/**` and fetched by a client. An
 * in-process contract is only an input/response schema bundle for a tool
 * operation in `lib/internal/<domain>/execute-tool.ts`, where `method` and
 * `path` are vestigial.
 *
 * A vestigial path whose route segment no longer exists is harmless: a caller
 * gets an honest 404. A vestigial path that still resolves to a live route
 * serving *other* methods is not — Next.js answers 405, which reads as "wrong
 * verb, endpoint is fine" and sends the caller looking in the wrong place. That
 * is the only case this script rejects, so it stays silent on the in-process
 * contracts whose routes were deleted outright.
 *
 * Contracts are read by importing each contract module and inspecting its
 * exported objects, the same way `check-route-verbs.ts` resolves the contract
 * behind a route. Scanning the source text instead would have to re-implement a
 * TypeScript lexer to know which braces are code and which sit inside a string,
 * template literal, regex or comment, and it could only ever see contracts whose
 * `method`/`path` are inline literals — the 70-plus built through helpers like
 * `definePostSelector(path, …)` would be invisible. Route files stay a static
 * scan on purpose: importing one drags in `@sim/db`, auth and `next/server`,
 * whereas contract modules are pure Zod.
 */
import { existsSync } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dir, '..')
const CONTRACTS_DIR = path.join(ROOT, 'apps/sim/lib/api/contracts')
const APP_API_DIR = path.join(ROOT, 'apps/sim/app/api')
const SKIP_DIRS = new Set(['node_modules', 'dist', '.next', '.turbo', 'coverage', '__tests__'])
const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const

type HttpMethod = (typeof HTTP_METHODS)[number]

interface DeclaredContract {
  name: string
  method: HttpMethod
  routePath: string
  module: string
}

async function listContractModules(dir: string, results: string[] = []): Promise<string[]> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) await listContractModules(full, results)
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) results.push(full)
  }
  return results
}

function isRouteContract(value: unknown): value is { method: HttpMethod; path: string } {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.method === 'string' &&
    (HTTP_METHODS as readonly string[]).includes(candidate.method) &&
    typeof candidate.path === 'string' &&
    typeof candidate.response === 'object' &&
    candidate.response !== null
  )
}

async function readIfFile(candidate: string): Promise<string | null> {
  try {
    if (!(await stat(candidate)).isFile()) return null
    return await readFile(candidate, 'utf8')
  } catch {
    return null
  }
}

/**
 * Resolves a contract path the way Next.js does: an exact segment match wins,
 * and only when none exists does the nearest catch-all ancestor
 * (`[...all]`, `[[...segments]]`) take the request. Without the fallback every
 * path served by a catch-all — all of `/api/auth/**`, `/api/v2/**` without its
 * own file — would look routeless and be silently exempted from the check.
 */
async function readRouteFile(routePath: string): Promise<string | null> {
  if (!routePath.startsWith('/api/')) return null
  const segments = routePath.slice('/api/'.length).split('/').filter(Boolean)

  const exact = await readIfFile(path.join(APP_API_DIR, ...segments, 'route.ts'))
  if (exact !== null) return exact

  for (let depth = segments.length; depth > 0; depth--) {
    const ancestor = path.join(APP_API_DIR, ...segments.slice(0, depth - 1))
    if (!existsSync(ancestor)) continue
    for (const entry of await readdir(ancestor, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      if (!entry.name.startsWith('[...') && !entry.name.startsWith('[[...')) continue
      const source = await readIfFile(path.join(ancestor, entry.name, 'route.ts'))
      if (source !== null) return source
    }
  }
  return null
}

function exportedMethods(source: string): Set<string> {
  const methods = new Set<string>()
  const group = HTTP_METHODS.join('|')
  for (const m of source.matchAll(
    new RegExp(`export\\s+(?:const|async\\s+function|function)\\s+(${group})\\b`, 'g')
  )) {
    methods.add(m[1])
  }
  for (const block of source.matchAll(/export\s*(?:const\s*)?\{([^}]*)\}/g)) {
    for (const clause of block[1].split(',')) {
      const local = clause
        .split(/\s+as\s+|:/)
        .pop()
        ?.trim()
      if (local && (HTTP_METHODS as readonly string[]).includes(local)) methods.add(local)
    }
  }
  return methods
}

async function collectContracts(): Promise<DeclaredContract[]> {
  const modules = await listContractModules(CONTRACTS_DIR)
  // Barrels re-export the same object, so keying by identity keeps one entry per
  // contract. Defining modules sort before `index.ts` so the report names them.
  modules.sort((a, b) => {
    const aBarrel = path.basename(a) === 'index.ts'
    const bBarrel = path.basename(b) === 'index.ts'
    return aBarrel === bBarrel ? a.localeCompare(b) : aBarrel ? 1 : -1
  })

  const seen = new Map<object, DeclaredContract>()
  for (const file of modules) {
    let loaded: Record<string, unknown>
    try {
      loaded = (await import(file)) as Record<string, unknown>
    } catch (error) {
      console.error(`✗ Could not import ${path.relative(ROOT, file)} to read its contracts:`)
      console.error(`  ${error instanceof Error ? error.message : String(error)}`)
      process.exit(1)
    }
    for (const [name, value] of Object.entries(loaded)) {
      if (!isRouteContract(value)) continue
      if (seen.has(value)) continue
      seen.set(value, {
        name,
        method: value.method,
        routePath: value.path,
        module: path.relative(ROOT, file),
      })
    }
  }
  return [...seen.values()]
}

async function main() {
  const contracts = await collectContracts()

  const violations: Array<DeclaredContract & { served: string[] }> = []
  const inProcess: DeclaredContract[] = []
  for (const contract of contracts) {
    const routeSource = await readRouteFile(contract.routePath)
    if (routeSource === null) {
      inProcess.push(contract)
      continue
    }
    const served = exportedMethods(routeSource)
    if (!served.has(contract.method)) violations.push({ ...contract, served: [...served].sort() })
  }

  if (process.argv.includes('--list-in-process')) {
    for (const c of [...inProcess].sort((a, b) => a.routePath.localeCompare(b.routePath))) {
      console.log(`  ${c.method.padEnd(6)} ${c.routePath}  ${c.name} (${c.module})`)
    }
  }

  if (violations.length > 0) {
    console.error(
      `✗ ${violations.length} contract(s) declare a method their live route does not serve:\n`
    )
    for (const v of violations) {
      console.error(`  ${v.method} ${v.routePath}`)
      console.error(`    contract: ${v.name} (${v.module})`)
      console.error(`    route serves: ${v.served.join(', ') || '(no methods)'}`)
      console.error(
        `    fix: export ${v.method} from the route, or drop the declaration if the endpoint is retired\n`
      )
    }
    process.exit(1)
  }

  console.log(
    `✓ ${contracts.length} route contracts agree with the methods their routes serve ` +
      `(${contracts.length - inProcess.length} boundary, ${inProcess.length} in-process; ` +
      `--list-in-process to enumerate)`
  )
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
