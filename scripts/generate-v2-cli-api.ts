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
 * carry hand-written descriptions, examples, and error responses that Zod
 * schemas do not encode. `scripts/check-openapi-specs.ts` reconciles those
 * against the same contracts instead, field by field, so the prose survives
 * while drift still fails CI.
 *
 * Usage:
 *   bun run scripts/generate-v2-cli-api.ts              # write the generated file
 *   bun run scripts/generate-v2-cli-api.ts --check      # fail if it is stale
 */

import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CONTRACTS_DIR = path.join(ROOT, 'apps/sim/lib/api/contracts/v2')
const OUTPUT = path.join(ROOT, 'packages/sim-cli/src/generated/v2-api.ts')
const DOCS_DIR = path.join(ROOT, 'apps/docs')

/**
 * OpenAPI documents to read operation summaries from, discovered rather than
 * listed — same reason as {@link contractModules}.
 *
 * A new spec file (`openapi-v2-resources.json` arrived with the MCP/skills/
 * folders/credentials endpoints) would otherwise go unread, and the only symptom
 * would be `--help` quietly falling back to `METHOD /path` for a whole domain.
 *
 * `openapi.json` is the retired single-document spec, superseded by the split
 * files; it is excluded by name because it still exists on disk and would
 * contribute stale duplicates.
 */
function specFiles(): string[] {
  return readdirSync(DOCS_DIR, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.startsWith('openapi') &&
        entry.name.endsWith('.json') &&
        entry.name !== 'openapi.json'
    )
    .map((entry) => entry.name)
    .sort()
}

/** What the OpenAPI specs say about one operation, beyond its request shape. */
export interface OperationDoc {
  /** The spec's one-line summary, used as the command's `--help` description. */
  summary?: string
  /**
   * The operation refuses a workspace API key, per its `description`.
   *
   * Carried so `--help` can say so before the request goes out; without it the
   * caller learns the restriction from a `403` after the fact.
   */
  workspaceKeyUnsupported?: true
}

/**
 * The description sentences that mark an operation as personal-key-only.
 *
 * Read out of `apps/sim/lib/api/contracts/v2/openapi/shared.ts` at generation
 * time rather than restated here, so rewording the sentence there cannot leave
 * the marker silently unemitted. The import is lazy because that module
 * resolves through the `@/` alias, which exists under `bun` but not under the
 * root `vitest` that imports this file's pure helpers.
 */
export async function loadWorkspaceKeyDenialMarkers(): Promise<readonly string[]> {
  const shared: Record<string, unknown> = await import(
    path.join(ROOT, 'apps/sim/lib/api/contracts/v2/openapi/shared.ts')
  )
  const markers = [shared.WORKSPACE_API_KEY_DENIED, shared.WORKSPACE_API_KEY_DENIED_AS_NOT_FOUND]
  for (const marker of markers) {
    if (typeof marker !== 'string' || !marker.trim()) {
      throw new Error('openapi/shared.ts no longer exports the workspace-key denial sentences')
    }
  }
  return markers as string[]
}

/**
 * `METHOD /api/v2/{id}/…` → what the specs document about that operation.
 *
 * The contracts carry validation, not prose, so `--help` text has to come from
 * somewhere else. The specs already hold a hand-written summary per operation
 * and `check:openapi` guarantees every contract has one, so reading them here
 * reuses documentation that is already written and already verified rather than
 * inventing a second place to describe the same endpoint. The longer
 * `description` is read for the same reason — it is where the workspace-key
 * denial is already stated.
 */
export function loadSummaries(
  workspaceKeyDenialMarkers: readonly string[]
): Map<string, OperationDoc> {
  const docs = new Map<string, OperationDoc>()

  for (const file of specFiles()) {
    let spec: Record<string, any>
    try {
      spec = JSON.parse(readFileSync(path.join(DOCS_DIR, file), 'utf8'))
    } catch {
      // A missing spec is not fatal: the CLI falls back to `METHOD path`, and
      // `check:openapi` is what actually enforces the specs' presence.
      continue
    }

    for (const [specPath, methods] of Object.entries(spec.paths ?? {})) {
      for (const [method, operation] of Object.entries(methods as Record<string, any>)) {
        const doc: OperationDoc = {}
        if (typeof operation?.summary === 'string') doc.summary = operation.summary
        const description = operation?.description
        if (
          typeof description === 'string' &&
          workspaceKeyDenialMarkers.some((marker) => description.includes(marker))
        ) {
          doc.workspaceKeyUnsupported = true
        }
        if (doc.summary || doc.workspaceKeyUnsupported) {
          docs.set(`${method.toUpperCase()} ${specPath}`, doc)
        }
      }
    }
  }

  return docs
}

/**
 * Every contract module under `contracts/v2`, discovered rather than listed.
 *
 * A hardcoded list is the wrong shape for this: adding a v2 domain would leave
 * its operations silently absent from the CLI, with no error and nothing in
 * `--check` to notice, because the generated file would still match a generator
 * that never looked. Discovery makes a new domain appear on the next
 * regeneration, which is the property the whole pipeline is built on.
 *
 * `shared.ts` holds the response-envelope helpers, not contracts; it is skipped
 * because it exports no route contract, not because it is named here.
 */
function contractModules(): string[] {
  return readdirSync(CONTRACTS_DIR, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith('.ts') &&
        !entry.name.endsWith('.test.ts') &&
        entry.name !== 'index.ts'
    )
    .map((entry) => entry.name.replace(/\.ts$/, ''))
    .sort()
}

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

  for (const domain of contractModules()) {
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
 * a known, narrow subset (no `patternProperties`, no draft-04 quirks), and the
 * output is committed and read by humans, so controlling the formatting is
 * worth more here than covering spec corners that never appear. An unhandled
 * construct throws rather than degrading to `any` — silence is how a generated
 * client drifts from its server.
 *
 * `refs` maps a `$defs` key to the TypeScript alias hoisted for it. Zod factors
 * a schema out into `$defs` when it is recursive, which the table view's filter
 * grammar is — a predicate holds predicates — so it cannot be inlined.
 */
function toTypeScript(schema: JsonSchema, indent = 0, refs?: Map<string, string>): string {
  if (typeof schema.$ref === 'string') {
    const key = schema.$ref.replace('#/$defs/', '')
    const name = refs?.get(key)
    if (!name) throw new Error(`Unresolved $ref: ${schema.$ref}`)
    return name
  }

  const pad = '  '.repeat(indent + 1)
  const closePad = '  '.repeat(indent)

  if (schema.const !== undefined) return JSON.stringify(schema.const)
  if (schema.enum) return schema.enum.map((v: unknown) => JSON.stringify(v)).join(' | ')

  const variants = schema.anyOf ?? schema.oneOf
  if (variants) {
    return variants.map((v: JsonSchema) => toTypeScript(v, indent, refs)).join(' | ')
  }

  if (schema.allOf) {
    return schema.allOf.map((v: JsonSchema) => toTypeScript(v, indent, refs)).join(' & ')
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
      return schema.items ? `Array<${toTypeScript(schema.items, indent, refs)}>` : 'unknown[]'
    case 'object': {
      const properties: Record<string, JsonSchema> = schema.properties ?? {}
      const required: string[] = schema.required ?? []
      const keys = Object.keys(properties)

      if (keys.length === 0) {
        // A bare object with only `additionalProperties` is a record.
        const value =
          schema.additionalProperties && typeof schema.additionalProperties === 'object'
            ? toTypeScript(schema.additionalProperties, indent, refs)
            : 'unknown'
        return `Record<string, ${value}>`
      }

      const lines = keys.map((key) => {
        const optional = required.includes(key) ? '' : '?'
        const safeKey = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key)
        return `${pad}${safeKey}${optional}: ${toTypeScript(properties[key], indent + 1, refs)}`
      })
      return `{\n${lines.join('\n')}\n${closePad}}`
    }
  }

  // `z.unknown()` / `z.any()` render as a schema carrying no constraints. A
  // `.describe()` on one adds annotation keys without narrowing the type, so
  // those are not constraints either.
  const ANNOTATION_KEYS = new Set(['$schema', 'description', 'title', 'default', 'examples'])
  if (Object.keys(schema).every((k) => ANNOTATION_KEYS.has(k))) return 'unknown'

  throw new Error(`Unhandled JSON Schema construct: ${JSON.stringify(schema).slice(0, 200)}`)
}

/**
 * A type plus any aliases that must be declared before it.
 *
 * A recursive schema cannot be written inline, so Zod lifts it into `$defs` and
 * points at it; those become real named types, which TypeScript resolves
 * recursively without complaint.
 */
interface GeneratedType {
  type: string
  declarations: string[]
}

function schemaToType(schema: z.ZodType, io: 'input' | 'output', name: string): GeneratedType {
  const json = z.toJSONSchema(schema, { io, unrepresentable: 'any' }) as JsonSchema
  const defs = json.$defs as Record<string, JsonSchema> | undefined
  if (!defs) return { type: toTypeScript(json), declarations: [] }

  // Named after the type that owns them, so two operations lifting their own
  // `__schema0` cannot collide in the single generated module.
  const refs = new Map(Object.keys(defs).map((key, index) => [key, `${name}Ref${index}`]))
  const declarations = Object.entries(defs).map(
    ([key, def]) => `type ${refs.get(key)} = ${toTypeScript(def, 0, refs)}\n`
  )

  const { $defs, ...root } = json
  return { type: toTypeScript(root, 0, refs), declarations }
}

/** Path params the CLI must substitute, e.g. `/api/v2/workflows/[id]` → `['id']`. */
function pathParams(routePath: string): string[] {
  return [...routePath.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1])
}

/**
 * `.describe()` for each path parameter, so a positional argument can explain
 * itself the way a flag does.
 *
 * The params schema is otherwise read only for its field names, which the route
 * path already supplies — the prose attached to them was being discarded, and
 * `sim tables rows get <tableId> <rowId>` had nothing to say about either.
 */
function pathParamDocs(schema: z.ZodType | undefined): Record<string, string> {
  if (!schema) return {}

  const json = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as JsonSchema
  const docs: Record<string, string> = {}

  for (const [key, property] of Object.entries(json.properties ?? {})) {
    const description = (property as JsonSchema).description
    if (typeof description === 'string' && description.trim()) docs[key] = description.trim()
  }

  return docs
}

/**
 * The kind a request field reduces to for the CLI's purposes.
 *
 * Everything from argv arrives as a string, so this is what tells the runtime
 * how to turn `"50"` into `50`, a bare `--flag` into `true`, and `'{"a":1}'`
 * into an object. `unknown` covers `z.unknown()`/`z.any()`, which the CLI can
 * only accept as JSON.
 */
type FieldKind =
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'enum'
  | 'array'
  | 'object'
  | 'unknown'

function fieldKind(schema: JsonSchema): FieldKind {
  if (schema.enum) return 'enum'

  const variants = schema.anyOf ?? schema.oneOf
  if (variants) {
    // Nullable is spelled as a union with `null`; a single non-null branch is
    // the field's real kind. A genuine multi-branch union has no single flag
    // shape, so it falls through to `unknown` and is taken as JSON.
    const concrete = variants.filter((v: JsonSchema) => v.type !== 'null')
    return concrete.length === 1 ? fieldKind(concrete[0]) : 'unknown'
  }

  const type = Array.isArray(schema.type)
    ? schema.type.find((t: string) => t !== 'null')
    : schema.type

  switch (type) {
    case 'string':
    case 'number':
    case 'integer':
    case 'boolean':
    case 'array':
    case 'object':
      return type
    default:
      return 'unknown'
  }
}

/**
 * Describes one request slot's fields for the runtime that builds flags.
 *
 * Emitted as data rather than baked into types because the CLI has to *iterate*
 * these at startup to construct commands — a type alone cannot be walked.
 */
/**
 * Whether the slot is a union, whose branches the CLI cannot turn into flags.
 *
 * Distinct from "the map came out empty": the shared fields of a union are
 * emitted as a map, so emptiness alone no longer identifies one, and the
 * runtime still has to know the rest of the body must come in as JSON.
 */
function isUnionSlot(schema: z.ZodType): boolean {
  const json = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as JsonSchema
  return Object.keys(json.properties ?? {}).length === 0 && Boolean(json.anyOf ?? json.oneOf)
}

/**
 * Headers the CLI sets itself, which must never become flags.
 *
 * `options.headers` is spread last over the client's own header block, so a
 * flag spelled `--x-api-key` would let argv replace the profile's credential —
 * a footgun on every command that carries it, and an authentication decision
 * argv has no business making. No contract declares one of these today; the
 * exclusion exists so that adding one does not quietly grow a flag for it.
 */
export const CLI_MANAGED_HEADERS: ReadonlySet<string> = new Set([
  'x-api-key',
  'authorization',
  'accept',
  'content-type',
  'user-agent',
])

export function renderSlotMap(
  schema: z.ZodType | undefined,
  indent: string,
  exclude?: ReadonlySet<string>
): string | null {
  if (!schema) return null

  const json = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as JsonSchema
  let properties: Record<string, JsonSchema> = json.properties ?? {}
  let required = new Set<string>(json.required ?? [])

  // A union has no properties of its own, but the fields every branch agrees on
  // are still known and still have to be sent — `workspaceId` is required by
  // both branches of the row-insert body and comes from the profile, so
  // dropping it left `tables rows create` rejected as invalid input.
  if (Object.keys(properties).length === 0) {
    const branches = (json.anyOf ?? json.oneOf) as JsonSchema[] | undefined
    if (branches?.length) {
      const shared = branches.reduce<string[]>(
        (keys, branch) => keys.filter((key) => branch.properties?.[key] !== undefined),
        Object.keys(branches[0].properties ?? {})
      )
      properties = Object.fromEntries(shared.map((key) => [key, branches[0].properties[key]]))
      required = new Set(shared.filter((key) => branches.every((b) => b.required?.includes(key))))
    }
  }

  const keys = Object.keys(properties).filter((key) => !exclude?.has(key))

  // A union body (e.g. single-row vs batch insert) has no flat field list. The
  // caller marks it `opaqueBody` so the runtime can offer the whole body as one
  // JSON flag instead.
  if (keys.length === 0) return null

  // A schema carrying `.meta({ id })` is lifted into `$defs` and referenced, so
  // the property here is a bare `$ref` with no type to classify. Left
  // unresolved every such field reads as `unknown` and the CLI demands JSON for
  // what is really a plain string flag.
  const defs = (json.$defs ?? {}) as Record<string, JsonSchema>
  const deref = (schema: JsonSchema): JsonSchema => {
    let current = schema
    for (let depth = 0; typeof current.$ref === 'string' && depth < 10; depth++) {
      const resolved = defs[current.$ref.replace('#/$defs/', '')]
      if (!resolved) break
      current = resolved
    }
    return current
  }

  const lines = keys.map((key) => {
    const property = deref(properties[key])
    const parts = [`kind: '${fieldKind(property)}'`]
    if (required.has(key)) parts.push('required: true')
    if (property.enum) {
      parts.push(
        `values: [${property.enum.map((v: unknown) => JSON.stringify(v)).join(', ')}] as const`
      )
    }
    if (property.default !== undefined) parts.push(`default: ${JSON.stringify(property.default)}`)
    // The contract's own `.describe()` is the field's documentation, and it is
    // already what the OpenAPI specs publish. Carrying it here is what lets
    // `--help` say what a flag means instead of restating its name back at the
    // reader as "Set sort by". Read from the reference site first: a field that
    // narrows a shared `$defs` schema describes its own use of it.
    const description = properties[key].description ?? property.description
    if (typeof description === 'string' && description.trim()) {
      parts.push(`describe: ${JSON.stringify(description.trim())}`)
    }
    return `${indent}  ${JSON.stringify(key)}: { ${parts.join(', ')} },`
  })

  return `{\n${lines.join('\n')}\n${indent}}`
}

function render(operations: Operation[], docs: Map<string, OperationDoc>): string {
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
      const slotName = `${Name}${pascal(slot)}`
      const generated = schemaToType(schema, 'input', slotName)
      out.push(...generated.declarations)
      out.push(`export type ${slotName} = ${generated.type}`)
      out.push('')
    }

    if (contract.response.mode === 'json' && contract.response.schema) {
      const generated = schemaToType(contract.response.schema, 'output', `${Name}Response`)
      out.push(...generated.declarations)
      out.push(`export type ${Name}Response = ${generated.type}`)
    } else {
      out.push(`/** Non-JSON response (\`${contract.response.mode}\`). */`)
      out.push(`export type ${Name}Response = never`)
    }
    out.push('')
  }

  out.push('/**')
  out.push(' * Every v2 operation, keyed by name.')
  out.push(' *')
  out.push(' * `query`, `body`, and `headers` describe each field well enough for the CLI')
  out.push(' * to build a flag for it and coerce the string argv gives back: its kind,')
  out.push(' * whether it is required, its enum values, and its server-side default. A slot')
  out.push(' * the contract does not declare — or one whose shape is a union with no flat')
  out.push(' * field list — is absent, and the runtime falls back to taking it as JSON.')
  out.push(' * Headers the CLI sets itself, such as the API key, are never listed.')
  out.push(' *')
  out.push(" * `summary` is the operation's one-line description, lifted from the OpenAPI")
  out.push(' * specs so `--help` reuses prose that is already written and already checked.')
  out.push(' *')
  out.push(' * `workspaceKeyUnsupported` marks an operation whose spec says a workspace')
  out.push(' * API key is rejected, so `--help` can say so before the request is sent.')
  out.push(' */')
  out.push('export const V2_OPERATIONS = {')
  for (const op of operations) {
    const params = pathParams(op.contract.path)
    out.push(`  ${op.name}: {`)
    out.push(`    method: '${op.contract.method}',`)
    out.push(`    path: '${op.contract.path}',`)
    out.push(`    pathParams: [${params.map((p) => `'${p}'`).join(', ')}] as const,`)
    const paramDocs = pathParamDocs(op.contract.params)
    const documentedParams = params.filter((p) => paramDocs[p])
    if (documentedParams.length > 0) {
      const entries = documentedParams.map(
        (p) => `${JSON.stringify(p)}: ${JSON.stringify(paramDocs[p])}`
      )
      out.push(`    pathParamDocs: { ${entries.join(', ')} },`)
    }
    out.push(`    responseMode: '${op.contract.response.mode}',`)
    // OpenAPI writes `{id}` where the contract writes `[id]`.
    const doc = docs.get(
      `${op.contract.method} ${op.contract.path.replace(/\[([^\]]+)\]/g, '{$1}')}`
    )
    if (doc?.summary) out.push(`    summary: ${JSON.stringify(doc.summary)},`)
    if (doc?.workspaceKeyUnsupported) out.push(`    workspaceKeyUnsupported: true,`)
    for (const slot of ['query', 'body'] as const) {
      const map = renderSlotMap(op.contract[slot], '    ')
      if (map) out.push(`    ${slot}: ${map},`)
      // A declared slot with no flat field list still has to be sendable.
      // Absence alone cannot say so: it means both "no body" and "a body the
      // generator could not describe", and reading it as the former left
      // `tables rows create` unable to send anything at all.
      if (slot === 'body' && op.contract.body && isUnionSlot(op.contract.body)) {
        out.push(`    opaqueBody: true,`)
      }
    }
    // Contract headers are request input like any other slot: `upload-token`
    // is what addresses an upload session, and leaving it out of this table
    // meant the runtime could not build a flag for it, so `files uploads get`
    // was rejected as invalid input on every call it could ever make.
    const headers = renderSlotMap(op.contract.headers, '    ', CLI_MANAGED_HEADERS)
    if (headers) out.push(`    headers: ${headers},`)
    out.push('  },')
  }
  out.push('} as const')
  out.push('')
  out.push('export type V2OperationName = keyof typeof V2_OPERATIONS')
  out.push('')

  return out.join('\n')
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

  const generated = format(render(operations, loadSummaries(await loadWorkspaceKeyDenialMarkers())))

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
    `Wrote ${path.relative(ROOT, OUTPUT)} — ${operations.length} operations from ${contractModules().length} contract modules.`
  )
}

// Guarded so the pure helpers above can be imported by tests without the
// generator writing a file as a side effect of the import.
if (import.meta.main) main()
