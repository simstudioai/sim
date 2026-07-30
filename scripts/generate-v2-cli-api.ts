#!/usr/bin/env bun
/**
 * Generates the Sim CLI's view of the public v2 API from the Zod route
 * contracts, so the terminal and the server cannot describe the same endpoint
 * differently.
 *
 * The contracts under `apps/sim/lib/api/contracts/v2/**` are the single source
 * of truth: the routes validate against them, so a shape that disagrees with a
 * contract is a shape the server would reject. Everything downstream is derived
 * rather than restated.
 *
 * The CLI cannot import the contracts directly — `packages/*` must never depend
 * on `apps/*` (scripts/check-monorepo-boundaries.ts). This script bridges that
 * at build time instead: it reads the contracts here and emits a file of plain
 * type declarations with no imports at all, so nothing about the package
 * boundary changes.
 *
 * Deliberately NOT generated: the OpenAPI documents under `apps/docs`. They
 * carry ~1000 hand-written descriptions and ~400 examples that Zod schemas do
 * not encode, and regenerating them would trade real documentation for
 * mechanical accuracy. `--check-openapi` reconciles their *structure* against
 * the contracts instead, so the prose survives while drift still fails CI.
 *
 * Usage:
 *   bun run scripts/generate-v2-cli-api.ts              # write the generated file
 *   bun run scripts/generate-v2-cli-api.ts --check      # fail if it is stale
 *   bun run scripts/generate-v2-cli-api.ts --check-openapi
 */

import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'

const ROOT = path.resolve(import.meta.dir, '..')
const CONTRACTS_DIR = path.join(ROOT, 'apps/sim/lib/api/contracts/v2')
const OUTPUT = path.join(ROOT, 'packages/sim-cli/src/generated/v2-api.ts')
const DOCS_DIR = path.join(ROOT, 'apps/docs')

/** Contract modules to read, in emit order. */
const DOMAINS = [
  'workflows',
  'logs',
  'tables',
  'files',
  'knowledge',
  'audit-logs',
  'billing',
] as const

interface RouteContract {
  method: string
  path: string
  params?: z.ZodType
  query?: z.ZodType
  body?: z.ZodType
  headers?: z.ZodType
  response: { mode: string; schema?: z.ZodType }
}

interface Operation {
  /** `listTables` — derived from the export name. */
  name: string
  domain: string
  contract: RouteContract
}

function isRouteContract(value: unknown): value is RouteContract {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<RouteContract>
  return (
    typeof candidate.method === 'string' &&
    typeof candidate.path === 'string' &&
    typeof candidate.response === 'object'
  )
}

/** `v2ListTablesContract` → `listTables`. */
function operationName(exportName: string): string {
  const stripped = exportName.replace(/^v2/, '').replace(/Contract$/, '')
  return stripped.charAt(0).toLowerCase() + stripped.slice(1)
}

function pascal(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1)
}

async function collectOperations(): Promise<Operation[]> {
  const operations: Operation[] = []

  for (const domain of DOMAINS) {
    const mod: Record<string, unknown> = await import(path.join(CONTRACTS_DIR, `${domain}.ts`))
    for (const [exportName, value] of Object.entries(mod)) {
      if (!exportName.endsWith('Contract') || !isRouteContract(value)) continue
      operations.push({ name: operationName(exportName), domain, contract: value })
    }
  }

  // Import order is stable, but sort anyway so a reordered export list does not
  // show up as a spurious diff in the generated file.
  return operations.sort((a, b) => a.name.localeCompare(b.name))
}

type JsonSchema = Record<string, any>

/**
 * Emits a TypeScript type for the subset of JSON Schema that `z.toJSONSchema`
 * produces from these contracts.
 *
 * Hand-rolled rather than pulled from `json-schema-to-typescript`: the input is
 * a known, narrow subset (no `$ref`, no `patternProperties`, no draft-04
 * quirks), and the output is committed and read by humans, so controlling the
 * formatting is worth more here than covering spec corners that never appear.
 * An unhandled construct throws rather than degrading to `any` — silence is how
 * a generated client drifts from its server.
 */
function toTypeScript(schema: JsonSchema, indent = 0): string {
  const pad = '  '.repeat(indent + 1)
  const closePad = '  '.repeat(indent)

  if (schema.const !== undefined) return JSON.stringify(schema.const)
  if (schema.enum) return schema.enum.map((v: unknown) => JSON.stringify(v)).join(' | ')

  const variants = schema.anyOf ?? schema.oneOf
  if (variants) {
    return variants.map((v: JsonSchema) => toTypeScript(v, indent)).join(' | ')
  }

  if (schema.allOf) {
    return schema.allOf.map((v: JsonSchema) => toTypeScript(v, indent)).join(' & ')
  }

  switch (schema.type) {
    case 'string':
      return 'string'
    case 'number':
    case 'integer':
      return 'number'
    case 'boolean':
      return 'boolean'
    case 'null':
      return 'null'
    case 'array':
      return schema.items ? `Array<${toTypeScript(schema.items, indent)}>` : 'unknown[]'
    case 'object': {
      const properties: Record<string, JsonSchema> = schema.properties ?? {}
      const required: string[] = schema.required ?? []
      const keys = Object.keys(properties)

      if (keys.length === 0) {
        // A bare object with only `additionalProperties` is a record.
        const value =
          schema.additionalProperties && typeof schema.additionalProperties === 'object'
            ? toTypeScript(schema.additionalProperties, indent)
            : 'unknown'
        return `Record<string, ${value}>`
      }

      const lines = keys.map((key) => {
        const optional = required.includes(key) ? '' : '?'
        const safeKey = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key)
        return `${pad}${safeKey}${optional}: ${toTypeScript(properties[key], indent + 1)}`
      })
      return `{\n${lines.join('\n')}\n${closePad}}`
    }
  }

  // `z.unknown()` / `z.any()` render as an empty schema.
  if (Object.keys(schema).filter((k) => k !== '$schema').length === 0) return 'unknown'

  throw new Error(`Unhandled JSON Schema construct: ${JSON.stringify(schema).slice(0, 200)}`)
}

function schemaToType(schema: z.ZodType, io: 'input' | 'output'): string {
  const json = z.toJSONSchema(schema, { io, unrepresentable: 'any' }) as JsonSchema
  return toTypeScript(json)
}

/** Path params the CLI must substitute, e.g. `/api/v2/workflows/[id]` → `['id']`. */
function pathParams(routePath: string): string[] {
  return [...routePath.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1])
}

function render(operations: Operation[]): string {
  const out: string[] = []

  out.push('/**')
  out.push(' * GENERATED FILE — DO NOT EDIT.')
  out.push(' *')
  out.push(' * Emitted from the Zod route contracts in')
  out.push(' * `apps/sim/lib/api/contracts/v2/**` by `scripts/generate-v2-cli-api.ts`.')
  out.push(' * Regenerate with `bun run generate:cli-api`; CI fails when this file is')
  out.push(' * stale, so edit the contract rather than this file.')
  out.push(' *')
  out.push(' * Contains only type declarations and one const table — no imports, so the')
  out.push(' * `packages/* must not import apps/*` boundary is preserved.')
  out.push(' */')
  out.push('')

  for (const op of operations) {
    const Name = pascal(op.name)
    const { contract } = op

    out.push(`/** \`${contract.method} ${contract.path}\` */`)

    for (const slot of ['params', 'query', 'body', 'headers'] as const) {
      const schema = contract[slot]
      if (!schema) continue
      out.push(`export type ${Name}${pascal(slot)} = ${schemaToType(schema, 'input')}`)
      out.push('')
    }

    if (contract.response.mode === 'json' && contract.response.schema) {
      out.push(`export type ${Name}Response = ${schemaToType(contract.response.schema, 'output')}`)
    } else {
      out.push(`/** Non-JSON response (\`${contract.response.mode}\`). */`)
      out.push(`export type ${Name}Response = never`)
    }
    out.push('')
  }

  out.push('/** Every v2 operation, keyed by name. */')
  out.push('export const V2_OPERATIONS = {')
  for (const op of operations) {
    const params = pathParams(op.contract.path)
    out.push(`  ${op.name}: {`)
    out.push(`    method: '${op.contract.method}',`)
    out.push(`    path: '${op.contract.path}',`)
    out.push(`    pathParams: [${params.map((p) => `'${p}'`).join(', ')}] as const,`)
    out.push(`    responseMode: '${op.contract.response.mode}',`)
    out.push('  },')
  }
  out.push('} as const')
  out.push('')
  out.push('export type V2OperationName = keyof typeof V2_OPERATIONS')
  out.push('')

  return out.join('\n')
}

/**
 * Reconciles the hand-written OpenAPI documents against the contracts.
 *
 * Structure only — every contract path/method must be documented, and every
 * documented v2 path/method must exist as a contract. Descriptions and examples
 * are the docs' own, and are deliberately not compared.
 */
function checkOpenApi(operations: Operation[]): string[] {
  const problems: string[] = []

  const documented = new Set<string>()
  for (const file of [
    'openapi-core.json',
    'openapi-v2-workflows.json',
    'openapi-v2-logs.json',
    'openapi-v2-tables.json',
    'openapi-v2-knowledge.json',
    'openapi-v2-files-audit.json',
  ]) {
    let spec: JsonSchema
    try {
      spec = JSON.parse(readFileSync(path.join(DOCS_DIR, file), 'utf8'))
    } catch {
      problems.push(`missing or unparseable spec: ${file}`)
      continue
    }
    for (const [specPath, methods] of Object.entries(spec.paths ?? {})) {
      for (const method of Object.keys(methods as object)) {
        if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue
        documented.add(`${method.toUpperCase()} ${specPath}`)
      }
    }
  }

  for (const op of operations) {
    // Contracts use Next.js `[id]`; OpenAPI uses `{id}`.
    const openApiPath = op.contract.path.replace(/\[([^\]]+)\]/g, '{$1}')
    const key = `${op.contract.method} ${openApiPath}`
    if (!documented.has(key)) {
      problems.push(`contract not documented in OpenAPI: ${key} (${op.name})`)
    }
    documented.delete(key)
  }

  for (const stale of documented) {
    if (stale.includes('/api/v2/')) {
      problems.push(`documented in OpenAPI but no contract: ${stale}`)
    }
  }

  return problems
}

/**
 * Runs the emitted source through Biome so the generated file is a fixed point
 * of the repo's formatter.
 *
 * Without this the file is rewritten on the way into a commit: lint-staged runs
 * `biome check --write` on explicit paths, which bypasses the `files.includes`
 * exclusion in biome.json. The result was a generated file that no longer
 * matched its generator, so `--check` failed in CI complaining about contract
 * drift that had not happened. Formatting here means the hook has nothing left
 * to change.
 */
function format(source: string): string {
  const result = spawnSync(
    path.join(ROOT, 'node_modules/.bin/biome'),
    ['format', `--stdin-file-path=${OUTPUT}`],
    { input: source, encoding: 'utf8' }
  )

  if (result.status !== 0 || !result.stdout) {
    // Fail loudly: silently emitting unformatted output would reintroduce the
    // exact hook-rewrites-generated-file loop this exists to close.
    throw new Error(
      `biome failed to format the generated output (status ${result.status}): ${result.stderr ?? ''}`
    )
  }

  return result.stdout
}

async function main() {
  const args = new Set(process.argv.slice(2))
  const operations = await collectOperations()

  if (args.has('--check-openapi')) {
    const problems = checkOpenApi(operations)
    if (problems.length > 0) {
      console.error('OpenAPI drift against the v2 contracts:\n')
      for (const problem of problems) console.error(`  - ${problem}`)
      console.error(
        '\nUpdate apps/docs/openapi-v2-*.json to match the contracts (the contracts are authoritative).'
      )
      process.exit(1)
    }
    console.log(`OpenAPI matches all ${operations.length} v2 contracts.`)
    return
  }

  const generated = format(render(operations))

  if (args.has('--check')) {
    let current = ''
    try {
      current = readFileSync(OUTPUT, 'utf8')
    } catch {
      console.error(`${path.relative(ROOT, OUTPUT)} is missing. Run: bun run generate:cli-api`)
      process.exit(1)
    }
    if (current !== generated) {
      console.error(
        `${path.relative(ROOT, OUTPUT)} is stale. Run: bun run generate:cli-api\n\n` +
          'The v2 contracts changed without the CLI being regenerated.'
      )
      process.exit(1)
    }
    console.log(`${path.relative(ROOT, OUTPUT)} is up to date (${operations.length} operations).`)
    return
  }

  writeFileSync(OUTPUT, generated)
  console.log(
    `Wrote ${path.relative(ROOT, OUTPUT)} — ${operations.length} operations from ${DOMAINS.length} contract modules.`
  )
}

main()
