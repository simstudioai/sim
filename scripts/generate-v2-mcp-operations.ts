#!/usr/bin/env bun
/**
 * Generates the Sim MCP server's operation table: every public v2 operation an
 * MCP tool call can reach, paired with the route handler that serves it.
 *
 * The MCP server is a second transport for the v2 API, not a second API. A tool
 * call is dispatched to the same route handler an HTTP request would reach, so
 * authentication, OAuth scopes, rate limits, validation, the application use
 * case, and the error envelope are all the route's own. This table is the one
 * thing that cannot be derived at runtime: Next.js loads route modules by file
 * path, so something has to name each module statically for the bundler.
 *
 * Operations come from {@link collectOperations} — the same contract discovery
 * the CLI generator uses — so the terminal and MCP expose one operation set
 * under one set of names. An operation is left out only when its transport
 * cannot be expressed as a JSON tool call: a binary response, or a body that
 * must be streamed as multipart. A route built by anything this script does not
 * recognize fails generation rather than being guessed at.
 *
 * Usage:
 *   bun run scripts/generate-v2-mcp-operations.ts              # write the generated file
 *   bun run scripts/generate-v2-mcp-operations.ts --check      # fail if it is stale
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  collectOperations,
  docPathKey,
  loadSummaries,
  loadWorkspaceKeyDenialMarkers,
  type Operation,
  type OperationDoc,
} from './generate-v2-cli-api'
import { localBin } from './local-bin'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const APP_ROOT = path.join(ROOT, 'apps/sim')
const OUTPUT = path.join(APP_ROOT, 'lib/api/mcp/generated/v2-operations.ts')

/** Route builders whose handlers answer a JSON request with a JSON response. */
const JSON_BUILDERS = new Set(['defineV2JsonRoute'])

/**
 * Raw `withRouteHandler` routes reviewed to answer a JSON request with JSON:
 * each streams only when the caller asks for it, which the MCP dispatcher
 * refuses. A raw route is a protocol exception by definition, so any other one
 * fails generation until it is reviewed and listed here.
 */
const REVIEWED_RAW_JSON_ROUTES = new Set(['chat', 'executeWorkflow', 'resumeWorkflow'])

/** Route builders whose transport a JSON tool call cannot carry. */
const NON_JSON_BUILDERS = new Set(['defineV2BinaryRoute', 'defineV2BodyLifecycleRoute'])

/** `/api/v2/tables/[tableId]/rows` → `app/api/v2/tables/[tableId]/rows/route.ts`. */
export function routeModulePath(contractPath: string): string {
  return `app${contractPath}/route.ts`
}

/** The builder a route module's `export const METHOD = builder(` uses, or `null` if none. */
export function routeBuilder(source: string, method: string): string | null {
  return source.match(new RegExp(`export const ${method} = (\\w+)\\(`))?.[1] ?? null
}

export interface McpOperation {
  name: string
  exportName: string
  domain: string
  method: string
  modulePath: string
  doc?: OperationDoc
}

/**
 * Whether an operation is reachable over MCP, reading its route module to learn
 * which builder serves it. Throws on a missing module or an unknown builder so a
 * new transport has to be classified here before it can ship.
 */
export function classifyOperation(
  operation: Operation,
  readRoute: (relativePath: string) => string | null
): 'json' | 'excluded' {
  if (operation.contract.response.mode !== 'json') return 'excluded'
  const modulePath = routeModulePath(operation.contract.path)
  const source = readRoute(modulePath)
  if (source === null) {
    throw new Error(`${operation.name}: no route module at apps/sim/${modulePath}`)
  }
  const builder = routeBuilder(source, operation.contract.method)
  if (builder && JSON_BUILDERS.has(builder)) return 'json'
  if (builder === 'withRouteHandler' && REVIEWED_RAW_JSON_ROUTES.has(operation.name)) return 'json'
  if (builder && NON_JSON_BUILDERS.has(builder)) return 'excluded'
  throw new Error(
    `${operation.name}: apps/sim/${modulePath} exports ${operation.contract.method} through ${
      builder ?? 'an unrecognized form'
    }; classify it in scripts/generate-v2-mcp-operations.ts`
  )
}

export function render(operations: readonly McpOperation[]): string {
  const importsByDomain = new Map<string, string[]>()
  for (const op of operations) {
    const names = importsByDomain.get(op.domain) ?? []
    names.push(op.exportName)
    importsByDomain.set(op.domain, names)
  }

  const out: string[] = [
    '/**',
    ' * GENERATED FILE — DO NOT EDIT.',
    ' *',
    ' * Emitted from the Zod route contracts in `apps/sim/lib/api/contracts/v2/**`',
    ' * by `scripts/generate-v2-mcp-operations.ts`. Regenerate with',
    ' * `bun run generate:mcp-operations`; CI fails when this file is stale.',
    ' */',
    '',
  ]
  for (const domain of [...importsByDomain.keys()].sort()) {
    const names = [...(importsByDomain.get(domain) ?? [])].sort()
    out.push(`import { ${names.join(', ')} } from '@/lib/api/contracts/v2/${domain}'`)
  }
  out.push("import type { V2McpOperation } from '@/lib/api/mcp/types'")
  out.push('')
  out.push('export const V2_MCP_OPERATIONS = {')
  for (const op of operations) {
    const specifier = `@/${op.modulePath.replace(/\.ts$/, '')}`
    out.push(`  ${op.name}: {`)
    out.push(`    contract: ${op.exportName},`)
    if (op.doc?.summary) out.push(`    summary: ${JSON.stringify(op.doc.summary)},`)
    if (op.doc?.description) out.push(`    description: ${JSON.stringify(op.doc.description)},`)
    if (op.doc?.workspaceKeyUnsupported) out.push('    workspaceKeyUnsupported: true,')
    out.push(`    handler: () => import('${specifier}').then((route) => route.${op.method}),`)
    out.push('  },')
  }
  out.push('} as const satisfies Record<string, V2McpOperation>')
  out.push('')
  out.push('export type V2McpOperationName = keyof typeof V2_MCP_OPERATIONS')
  out.push('')
  return out.join('\n')
}

/**
 * Runs the emitted source through `biome check --write`, not only the
 * formatter: the import list is sorted too, and lint-staged applies exactly
 * that to a committed file, so anything less leaves a file the hook rewrites
 * and `--check` then reports as stale.
 */
function format(source: string): string {
  const result = spawnSync(localBin('biome'), ['check', '--write', `--stdin-file-path=${OUTPUT}`], {
    cwd: ROOT,
    encoding: 'utf8',
    input: source,
  })
  if (result.status !== 0 || !result.stdout) {
    throw new Error(`biome failed on the generated operation table: ${result.stderr ?? ''}`)
  }
  return result.stdout
}

async function main() {
  const check = process.argv.includes('--check')
  const docs = loadSummaries(await loadWorkspaceKeyDenialMarkers())
  const readRoute = (relativePath: string) => {
    const file = path.join(APP_ROOT, relativePath)
    return existsSync(file) ? readFileSync(file, 'utf8') : null
  }

  const operations: McpOperation[] = []
  let excluded = 0
  for (const operation of await collectOperations()) {
    if (classifyOperation(operation, readRoute) === 'excluded') {
      excluded++
      continue
    }
    operations.push({
      name: operation.name,
      exportName: operation.exportName,
      domain: operation.domain,
      method: operation.contract.method,
      modulePath: routeModulePath(operation.contract.path),
      doc: docs.get(docPathKey(operation.contract.method, operation.contract.path)),
    })
  }

  const generated = format(render(operations))
  const relative = path.relative(ROOT, OUTPUT)

  if (check) {
    const current = existsSync(OUTPUT) ? readFileSync(OUTPUT, 'utf8') : null
    if (current !== generated) {
      console.error(
        `${relative} is ${current === null ? 'missing' : 'stale'}. Run: bun run generate:mcp-operations`
      )
      process.exit(1)
    }
    console.log(`${relative} is up to date (${operations.length} operations).`)
    return
  }

  writeFileSync(OUTPUT, generated)
  console.log(
    `Wrote ${relative} — ${operations.length} operations (${excluded} excluded: binary or multipart transport).`
  )
}

if (import.meta.main) main()
