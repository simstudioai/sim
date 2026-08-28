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
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dir, '..')
const CONTRACTS_DIR = path.join(ROOT, 'apps/sim/lib/api/contracts')
const APP_API_DIR = path.join(ROOT, 'apps/sim/app/api')
const SKIP_DIRS = new Set(['node_modules', 'dist', '.next', '.turbo', 'coverage', '__tests__'])
const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const

interface DeclaredContract {
  name: string
  method: string
  routePath: string
  file: string
  line: number
}

async function walk(dir: string, results: string[] = []): Promise<string[]> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) await walk(full, results)
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) results.push(full)
  }
  return results
}

/** Reads the balanced object literal passed to each `defineRouteContract(` call. */
function parseContracts(source: string, file: string): DeclaredContract[] {
  const found: DeclaredContract[] = []
  const opener = /defineRouteContract\s*\(\s*\{/g
  let match: RegExpExecArray | null
  while ((match = opener.exec(source))) {
    let cursor = match.index + match[0].length - 1
    const start = cursor
    let depth = 0
    for (; cursor < source.length; cursor++) {
      const char = source[cursor]
      if (char === '{') depth++
      else if (char === '}' && --depth === 0) break
    }
    const literal = source.slice(start, cursor + 1)
    const method = literal.match(/(?:^|[\s,{])method\s*:\s*'([A-Z]+)'/)?.[1]
    const routePath = literal.match(/(?:^|[\s,{])path\s*:\s*'([^']+)'/)?.[1]
    if (!method || !routePath) continue
    const preceding = source.slice(0, match.index)
    found.push({
      name: [...preceding.matchAll(/export\s+const\s+([A-Za-z0-9_]+)/g)].pop()?.[1] ?? 'anonymous',
      method,
      routePath,
      file: path.relative(ROOT, file),
      line: preceding.split('\n').length,
    })
  }
  return found
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
    let entries
    try {
      entries = await readdir(ancestor, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
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

async function main() {
  const contracts: DeclaredContract[] = []
  for (const file of await walk(CONTRACTS_DIR)) {
    contracts.push(...parseContracts(await readFile(file, 'utf8'), file))
  }

  const violations: Array<DeclaredContract & { served: string[] }> = []
  const inProcess: DeclaredContract[] = []
  for (const contract of contracts) {
    const routeSource = await readRouteFile(contract.routePath)
    if (routeSource === null) {
      inProcess.push(contract)
      continue
    }
    const served = exportedMethods(routeSource)
    if (!served.has(contract.method)) {
      violations.push({ ...contract, served: [...served].sort() })
    }
  }

  if (process.argv.includes('--list-in-process')) {
    for (const c of [...inProcess].sort((a, b) => a.routePath.localeCompare(b.routePath))) {
      console.log(`  ${c.method.padEnd(6)} ${c.routePath}  ${c.name} (${c.file}:${c.line})`)
    }
  }

  if (violations.length > 0) {
    console.error(
      `✗ ${violations.length} contract(s) declare a method their live route does not serve:\n`
    )
    for (const v of violations) {
      console.error(`  ${v.method} ${v.routePath}`)
      console.error(`    contract: ${v.name} (${v.file}:${v.line})`)
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
