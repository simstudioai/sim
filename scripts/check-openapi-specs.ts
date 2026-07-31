#!/usr/bin/env bun
/**
 * Validates the hand-authored OpenAPI specs in `apps/docs/` against each other
 * and against the runtime Zod contracts in `apps/sim/lib/api/contracts/`.
 *
 * The Zod contracts are the runtime source of truth for *success* request and
 * response shapes, but the specs additionally carry what Zod never defines —
 * error envelopes, status codes, prose, and examples — so the specs cannot be
 * generated and must instead be checked:
 *
 * 1. Spec integrity (every file): all `$ref`s resolve, operationIds are
 *    present and unique, every operation documents a success response, no
 *    orphaned component schemas.
 * 2. v2 conventions (every `/api/v2/` operation): 401 and 429 are documented,
 *    and every documented 4xx/5xx resolves to the canonical error envelope
 *    `{ error: { code, message } }`.
 * 3. Contract cross-check: every contract exported from
 *    `lib/api/contracts/v2/*` must be documented, every documented `/api/v2/`
 *    operation must have a contract, and for each pair the query params,
 *    body fields, and response fields are diffed via `z.toJSONSchema`.
 * 4. Examples: documented request/response examples are parsed with the
 *    matching contract's actual Zod schemas — a doc example that the runtime
 *    would reject fails the build.
 */

import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'

const ROOT = path.resolve(import.meta.dir, '..')
const DOCS_DIR = path.join(ROOT, 'apps/docs')
const V2_CONTRACTS_DIR = path.join(ROOT, 'apps/sim/lib/api/contracts/v2')

const SPEC_FILES = [
  'openapi-core.json',
  'openapi-v2-logs.json',
  'openapi-v2-workflows.json',
  'openapi-v2-tables.json',
  'openapi-v2-knowledge.json',
  'openapi-v2-files-audit.json',
]

/** Extra non-v2 contracts that are documented in the core spec. */
const EXTRA_CONTRACT_MODULES = [path.join(ROOT, 'apps/sim/lib/api/contracts/usage-limits.ts')]

type Json = Record<string, unknown>
const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete'])

const errors: string[] = []
const fail = (spec: string, msg: string) => errors.push(`${spec}: ${msg}`)

interface ContractLike {
  method: string
  path: string
  params?: z.ZodType
  query?: z.ZodType
  body?: z.ZodType
  response?: { mode: string; schema?: z.ZodType }
}

function isContract(value: unknown): value is ContractLike {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as ContractLike).method === 'string' &&
    typeof (value as ContractLike).path === 'string' &&
    typeof (value as ContractLike).response === 'object'
  )
}

/** `[tableId]` (contract) → `{tableId}` (OpenAPI). */
const contractKey = (c: ContractLike) =>
  `${c.method.toUpperCase()} ${c.path.replace(/\[([^\]]+)\]/g, '{$1}')}`

async function loadContracts(): Promise<Map<string, { name: string; contract: ContractLike }>> {
  const registry = new Map<string, { name: string; contract: ContractLike }>()
  const files = readdirSync(V2_CONTRACTS_DIR)
    .filter((f) => f.endsWith('.ts') && f !== 'shared.ts')
    .map((f) => path.join(V2_CONTRACTS_DIR, f))
  for (const file of [...files, ...EXTRA_CONTRACT_MODULES]) {
    const mod = (await import(file)) as Record<string, unknown>
    for (const [name, value] of Object.entries(mod)) {
      if (!isContract(value)) continue
      const key = contractKey(value)
      const existing = registry.get(key)
      if (existing) {
        // A route may expose narrowing variants of one operation (e.g. the
        // batch-create alias) — keep the first, they share the wire.
        continue
      }
      registry.set(key, { name, contract: value })
    }
  }
  return registry
}

function resolveRef(ref: string, spec: Json): unknown {
  let current: unknown = spec
  for (const part of ref.replace('#/', '').split('/')) {
    if (!current || typeof current !== 'object') return undefined
    current = (current as Json)[part]
  }
  return current
}

/** Follow at most one level of `$ref` chains until a concrete node. */
function deref(node: unknown, spec: Json): unknown {
  let current = node
  for (let i = 0; i < 8; i++) {
    if (current && typeof current === 'object' && typeof (current as Json).$ref === 'string') {
      current = resolveRef((current as Json).$ref as string, spec)
    } else {
      return current
    }
  }
  return current
}

function walkRefs(node: unknown, visit: (ref: string) => void): void {
  if (Array.isArray(node)) {
    for (const item of node) walkRefs(item, visit)
  } else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (key === '$ref' && typeof value === 'string') visit(value)
      else walkRefs(value, visit)
    }
  }
}

/**
 * Top-level property names of a documented JSON schema, unioning `oneOf` /
 * `anyOf` / `allOf` variants. Returns `null` when the schema is opaque
 * (no `properties` anywhere), in which case comparison is skipped.
 */
function docPropertyNames(schema: unknown, spec: Json): Set<string> | null {
  const node = deref(schema, spec)
  if (!node || typeof node !== 'object') return null
  const record = node as Json
  const variants = (record.oneOf ?? record.anyOf ?? record.allOf) as unknown[] | undefined
  if (variants) {
    const names = new Set<string>()
    let sawAny = false
    for (const variant of variants) {
      const sub = docPropertyNames(variant, spec)
      if (sub) {
        sawAny = true
        for (const n of sub) names.add(n)
      }
    }
    return sawAny ? names : null
  }
  if (record.properties && typeof record.properties === 'object') {
    return new Set(Object.keys(record.properties as Json))
  }
  return null
}

function toJsonSchema(schema: z.ZodType, io: 'input' | 'output'): Json | null {
  try {
    return z.toJSONSchema(schema, { io, unrepresentable: 'any' }) as Json
  } catch {
    return null
  }
}

interface Operation {
  specFile: string
  path: string
  method: string
  op: Json
  spec: Json
}

function collectOperations(specFile: string, spec: Json): Operation[] {
  const ops: Operation[] = []
  for (const [p, methods] of Object.entries((spec.paths as Json) ?? {})) {
    if (!methods || typeof methods !== 'object') continue
    for (const [method, op] of Object.entries(methods as Json)) {
      if (!HTTP_METHODS.has(method)) continue
      ops.push({ specFile, path: p, method, op: op as Json, spec })
    }
  }
  return ops
}

function checkIntegrity(specFile: string, spec: Json, ops: Operation[]): void {
  walkRefs(spec, (ref) => {
    if (resolveRef(ref, spec) === undefined) fail(specFile, `unresolved $ref ${ref}`)
  })

  const seenIds = new Set<string>()
  for (const { path: p, method, op } of ops) {
    const label = `${method.toUpperCase()} ${p}`
    const id = op.operationId
    if (typeof id !== 'string' || !id) {
      fail(specFile, `${label}: missing operationId`)
    } else if (seenIds.has(id)) {
      fail(specFile, `${label}: duplicate operationId "${id}"`)
    } else {
      seenIds.add(id)
    }
    const responses = (op.responses as Json) ?? {}
    if (!Object.keys(responses).some((code) => code.startsWith('2'))) {
      fail(specFile, `${label}: no documented 2xx response`)
    }
  }

  const schemas = ((spec.components as Json)?.schemas as Json) ?? {}
  const blobWithout = (name: string) =>
    JSON.stringify({
      ...spec,
      components: { ...(spec.components as Json), schemas: { ...schemas, [name]: null } },
    })
  for (const name of Object.keys(schemas)) {
    if (!blobWithout(name).includes(`"#/components/schemas/${name}"`)) {
      fail(specFile, `orphaned component schema "${name}" (unreferenced)`)
    }
  }
}

function checkV2Conventions(operation: Operation): void {
  const { specFile, path: p, method, op, spec } = operation
  const label = `${method.toUpperCase()} ${p}`
  const responses = (op.responses as Json) ?? {}

  for (const code of ['401', '429']) {
    if (!(code in responses)) fail(specFile, `${label}: v2 operation missing ${code} response`)
  }

  for (const [code, response] of Object.entries(responses)) {
    if (!/^[45]/.test(code)) continue
    const resolved = deref(response, spec) as Json | undefined
    const schema = deref(
      ((resolved?.content as Json)?.['application/json'] as Json)?.schema,
      spec
    ) as Json | undefined
    // A bodyless error (e.g. a bare 413) documents intent without a schema.
    if (!schema) continue
    const errorProp = deref((schema.properties as Json)?.error, spec) as Json | undefined
    const inner = errorProp?.properties as Json | undefined
    if (!inner || !('code' in inner) || !('message' in inner)) {
      fail(
        specFile,
        `${label}: ${code} response is not the canonical v2 error envelope { error: { code, message } }`
      )
    }
  }
}

function checkQueryParams(operation: Operation, contract: ContractLike, name: string): void {
  const { specFile, path: p, method, op, spec } = operation
  const label = `${method.toUpperCase()} ${p}`
  if (!contract.query) return
  const zodSchema = toJsonSchema(contract.query, 'input')
  if (!zodSchema?.properties) return

  const docParams = new Map<string, Json>()
  for (const raw of (op.parameters as unknown[]) ?? []) {
    const param = deref(raw, spec) as Json | undefined
    if (param?.in === 'query' && typeof param.name === 'string') docParams.set(param.name, param)
  }

  const zodProps = Object.keys(zodSchema.properties as Json)
  const zodRequired = new Set((zodSchema.required as string[]) ?? [])
  for (const prop of zodProps) {
    const doc = docParams.get(prop)
    if (!doc) {
      fail(specFile, `${label}: query param "${prop}" (${name}) is not documented`)
    } else if (Boolean(doc.required) !== zodRequired.has(prop)) {
      fail(
        specFile,
        `${label}: query param "${prop}" required mismatch (contract ${zodRequired.has(prop) ? 'required' : 'optional'}, docs ${doc.required ? 'required' : 'optional'})`
      )
    }
  }
  for (const docName of docParams.keys()) {
    if (!zodProps.includes(docName)) {
      fail(specFile, `${label}: documented query param "${docName}" does not exist on ${name}`)
    }
  }
}

/** Property subschema lookup, searching `oneOf`/`anyOf`/`allOf` variants. */
function propertyNode(schema: unknown, root: Json, prop: string): unknown {
  const node = deref(schema, root)
  if (!node || typeof node !== 'object') return undefined
  const record = node as Json
  const variants = (record.oneOf ?? record.anyOf ?? record.allOf) as unknown[] | undefined
  if (variants) {
    for (const variant of variants) {
      const found = propertyNode(variant, root, prop)
      if (found !== undefined) return found
    }
    return undefined
  }
  return (record.properties as Json | undefined)?.[prop]
}

/** Deref + step through array wrappers so item objects compare directly. */
function unwrapArrays(node: unknown, root: Json): unknown {
  let current = deref(node, root)
  for (let i = 0; i < 3; i++) {
    const record = current as Json | null
    if (record && typeof record === 'object' && record.type === 'array' && record.items) {
      current = deref(record.items, root)
    } else {
      break
    }
  }
  return current
}

interface DiffContext {
  specFile: string
  label: string
  name: string
  where: 'body' | 'response'
}

/**
 * Recursively diffs property-name sets between the Zod-derived JSON schema and
 * the documented one, descending through matching object properties and array
 * items. Comparison happens only where BOTH sides expose a property set — an
 * opaque side (records, `additionalProperties`, prose-only docs) ends the
 * descent instead of producing false positives. The Zod root doubles as the
 * `$defs` resolution context for recursive schemas.
 */
function diffSchemaFields(
  zodNode: unknown,
  zodRoot: Json,
  docNode: unknown,
  docRoot: Json,
  ctx: DiffContext,
  prefix: string,
  depth: number
): void {
  if (depth > 4) return
  const zodObj = unwrapArrays(zodNode, zodRoot)
  const docObj = unwrapArrays(docNode, docRoot)
  const zodNames = docPropertyNames(zodObj, zodRoot)
  const docNames = docPropertyNames(docObj, docRoot)
  if (!zodNames || !docNames) return
  const fieldPath = (n: string) => (prefix ? `${prefix}.${n}` : n)
  /**
   * A `.passthrough()` contract deliberately under-declares its fields, so the
   * docs are allowed to document more than the Zod side names.
   */
  const extra = (zodObj as Json).additionalProperties
  const zodIsPassthrough =
    extra === true || (!!extra && typeof extra === 'object' && Object.keys(extra).length === 0)
  for (const n of zodNames) {
    if (!docNames.has(n)) {
      fail(
        ctx.specFile,
        `${ctx.label}: ${ctx.where} field "${fieldPath(n)}" (${ctx.name}) not documented`
      )
    }
  }
  for (const n of docNames) {
    if (!zodNames.has(n) && !zodIsPassthrough) {
      fail(
        ctx.specFile,
        `${ctx.label}: documented ${ctx.where} field "${fieldPath(n)}" does not exist on ${ctx.name}`
      )
    }
  }
  for (const n of zodNames) {
    if (!docNames.has(n)) continue
    diffSchemaFields(
      propertyNode(zodObj, zodRoot, n),
      zodRoot,
      propertyNode(docObj, docRoot, n),
      docRoot,
      ctx,
      fieldPath(n),
      depth + 1
    )
  }
}

function checkBodyAndResponse(operation: Operation, contract: ContractLike, name: string): void {
  const { specFile, path: p, method, op, spec } = operation
  const label = `${method.toUpperCase()} ${p}`

  const docBodySchema = ((deref(op.requestBody, spec) as Json)?.content as Json)?.[
    'application/json'
  ] as Json | undefined
  if (contract.body && docBodySchema?.schema) {
    const zodRoot = toJsonSchema(contract.body, 'input')
    if (zodRoot) {
      diffSchemaFields(
        zodRoot,
        zodRoot,
        docBodySchema.schema,
        spec,
        { specFile, label, name, where: 'body' },
        '',
        0
      )
    }
  }

  if (contract.response?.mode === 'json' && contract.response.schema) {
    const responses = (op.responses as Json) ?? {}
    const successCode = Object.keys(responses).find((code) => code.startsWith('2'))
    const docResponse = successCode ? (deref(responses[successCode], spec) as Json) : undefined
    const docSchema = ((docResponse?.content as Json)?.['application/json'] as Json)?.schema
    if (docSchema) {
      const zodRoot = toJsonSchema(contract.response.schema, 'output')
      if (zodRoot) {
        diffSchemaFields(
          zodRoot,
          zodRoot,
          docSchema,
          spec,
          { specFile, label, name, where: 'response' },
          '',
          0
        )
      }
    }
  }
}

function checkExamples(operation: Operation, contract: ContractLike, name: string): void {
  const { specFile, path: p, method, op, spec } = operation
  const label = `${method.toUpperCase()} ${p}`

  const bodyContent = ((deref(op.requestBody, spec) as Json)?.content as Json)?.[
    'application/json'
  ] as Json | undefined
  if (contract.body && bodyContent) {
    const candidates: Array<[string, unknown]> = []
    if (bodyContent.example !== undefined) candidates.push(['example', bodyContent.example])
    for (const [exName, ex] of Object.entries((bodyContent.examples as Json) ?? {})) {
      candidates.push([exName, (ex as Json).value])
    }
    for (const [exName, value] of candidates) {
      const parsed = contract.body.safeParse(value)
      if (!parsed.success) {
        fail(
          specFile,
          `${label}: request example "${exName}" rejected by ${name}: ${parsed.error.issues[0]?.message}`
        )
      }
    }
  }

  if (contract.response?.mode === 'json' && contract.response.schema) {
    const responses = (op.responses as Json) ?? {}
    const successCode = Object.keys(responses).find((code) => code.startsWith('2'))
    const docResponse = successCode ? (deref(responses[successCode], spec) as Json) : undefined
    const content = (docResponse?.content as Json)?.['application/json'] as Json | undefined
    if (content?.example !== undefined) {
      const parsed = contract.response.schema.safeParse(content.example)
      if (!parsed.success) {
        const issue = parsed.error.issues[0]
        fail(
          specFile,
          `${label}: response example rejected by ${name} at ${issue?.path.join('.') || '<root>'}: ${issue?.message}`
        )
      }
    }
  }
}

const registry = await loadContracts()
const documentedKeys = new Set<string>()

for (const specFile of SPEC_FILES) {
  const spec = JSON.parse(readFileSync(path.join(DOCS_DIR, specFile), 'utf8')) as Json
  const ops = collectOperations(specFile, spec)
  checkIntegrity(specFile, spec, ops)

  for (const operation of ops) {
    const key = `${operation.method.toUpperCase()} ${operation.path}`
    documentedKeys.add(key)
    const isV2 = operation.path.startsWith('/api/v2/')
    if (isV2) checkV2Conventions(operation)

    const entry = registry.get(key)
    if (!entry) {
      // The core spec's execution/HITL surface predates the contract registry;
      // only the v2 surface requires a contract for every documented operation.
      if (isV2) fail(specFile, `${key}: documented but no contract exports this route`)
      continue
    }
    checkQueryParams(operation, entry.contract, entry.name)
    checkBodyAndResponse(operation, entry.contract, entry.name)
    checkExamples(operation, entry.contract, entry.name)
  }
}

for (const [key, { name }] of registry) {
  if (!key.includes('/api/v2/')) continue
  if (!documentedKeys.has(key)) {
    errors.push(`registry: ${name} (${key}) is not documented in any OpenAPI spec`)
  }
}

if (errors.length > 0) {
  console.error(
    `OpenAPI spec validation failed (${errors.length} issue${errors.length === 1 ? '' : 's'}):`
  )
  for (const message of errors) console.error(`  - ${message}`)
  process.exit(1)
}
console.log(
  `OpenAPI spec validation passed: ${SPEC_FILES.length} specs, ${documentedKeys.size} operations, ${registry.size} contracts cross-checked.`
)
