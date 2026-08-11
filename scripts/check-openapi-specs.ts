#!/usr/bin/env bun
/**
 * Validates the OpenAPI specs in `apps/docs/` against each other and against
 * the runtime Zod contracts in `apps/sim/lib/api/contracts/`.
 *
 * Every document is code-first, carries `x-generated-by`, and is checked for
 * staleness by `generate-openapi.ts --check` before this script runs.
 *
 * 1. Spec integrity (every file): all `$ref`s resolve, operationIds are
 *    present and unique, every operation documents a success response, no
 *    orphaned component schemas.
 * 2. v2 conventions: every published operation is under `/api/v2/`, documents
 *    401, 429, and 503, and resolves every documented 4xx/5xx response to the
 *    canonical error envelope `{ error: { code, message } }`.
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
import Ajv2020 from 'ajv/dist/2020'
import { z } from 'zod'
import { OPENAPI_SPEC_FILES } from '../apps/docs/lib/openapi-specs'

const ROOT = path.resolve(import.meta.dir, '..')
const DOCS_DIR = path.join(ROOT, 'apps/docs')
const V2_CONTRACTS_DIR = path.join(ROOT, 'apps/sim/lib/api/contracts/v2')

const SPEC_FILES = OPENAPI_SPEC_FILES

/**
 * Every operation removed with the unversioned core specification has a
 * public v2 replacement. Keeping this mapping executable prevents a future
 * docs edit from accidentally dropping a migrated execution, HITL, or usage
 * capability.
 */
const LEGACY_CORE_REPLACEMENTS = {
  executeWorkflow: 'POST /api/v2/workflows/{id}/execute',
  getWorkflowExecution: 'GET /api/v2/workflows/{id}/runs/{runId}',
  cancelExecution: 'POST /api/v2/workflows/{id}/runs/{runId}/cancel',
  getJobStatus: 'GET /api/v2/workflows/{id}/runs/{runId}',
  listPausedExecutions: 'GET /api/v2/workflows/{id}/runs',
  getPausedExecution: 'GET /api/v2/workflows/{id}/runs/{runId}',
  getPausedExecutionByResumePath: 'GET /api/v2/workflows/{id}/runs/{runId}',
  getPauseContext: 'GET /api/v2/workflows/{id}/runs/{runId}',
  resumeExecution: 'POST /api/v2/workflows/{id}/runs/{runId}/resume',
  getUsageLimits: 'GET /api/v2/billing/status',
} as const

const API_REFERENCE_LOCALES = ['de', 'en', 'es', 'fr', 'ja', 'zh'] as const
const REQUIRED_API_REFERENCE_GROUPS = [
  '(generated)/workflows',
  '(generated)/workflow-runs',
  '(generated)/logs',
  '(generated)/audit-logs',
  '(generated)/billing',
  '(generated)/tables',
  '(generated)/files',
  '(generated)/knowledge-bases',
  '(generated)/workspaces',
  '(generated)/mcp-servers',
  '(generated)/skills',
  '(generated)/custom-tools',
  '(generated)/credentials',
  '(generated)/secrets',
] as const
const REMOVED_API_REFERENCE_GROUPS = [
  '(generated)/execution',
  '(generated)/human-in-the-loop',
  '(generated)/usage',
] as const

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
  response?: {
    mode: string
    schema?: z.ZodType
    status?: number | readonly number[]
    statusSchemas?: Readonly<Record<number, z.ZodType>>
  }
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
  for (const file of files) {
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

function toJsonSchema(schema: z.ZodType, io: 'input' | 'output'): Json {
  return z.toJSONSchema(schema, {
    io,
    target: 'draft-2020-12',
    unrepresentable: 'any',
    cycles: 'ref',
  }) as Json
}

const outputExampleValidator = new Ajv2020({
  strict: false,
  allErrors: true,
  validateFormats: false,
})

function stripLegacySchemaIds(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripLegacySchemaIds)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, entry]) => key !== 'id' || typeof entry !== 'string')
      .map(([key, entry]) => [key, stripLegacySchemaIds(entry)])
  )
}

function outputExampleError(schema: z.ZodType, value: unknown): string | null {
  const validate = outputExampleValidator.compile(
    stripLegacySchemaIds(toJsonSchema(schema, 'output'))
  )
  if (validate(value)) return null
  return outputExampleValidator.errorsText(validate.errors)
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

function isSuccessStatus(code: string): boolean {
  const status = Number(code)
  return Number.isInteger(status) && status >= 200 && status < 400
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
    if (!Object.keys(responses).some(isSuccessStatus)) {
      fail(specFile, `${label}: no documented success response`)
    }

    const requestBody = deref(op.requestBody, spec) as Json | undefined
    if (requestBody) {
      const content = requestBody.content as Json | undefined
      if (!content || Object.keys(content).length === 0) {
        fail(specFile, `${label}: request body has no content types`)
      } else {
        for (const [contentType, media] of Object.entries(content)) {
          if (!(media as Json)?.schema) {
            fail(specFile, `${label}: ${contentType} request body has no schema`)
          }
        }
      }
    }

    for (const [status, response] of Object.entries(responses)) {
      if (!isSuccessStatus(status)) continue
      const resolved = deref(response, spec) as Json | undefined
      const content = resolved?.content as Json | undefined
      if (!content) continue
      if (Object.keys(content).length === 0) {
        fail(specFile, `${label}: ${status} response has an empty content map`)
        continue
      }
      for (const [contentType, media] of Object.entries(content)) {
        if (!(media as Json)?.schema) {
          fail(specFile, `${label}: ${status} ${contentType} response has no schema`)
        }
      }
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

  for (const code of ['401', '429', '503']) {
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

function checkSuccessStatuses(operation: Operation, contract: ContractLike): void {
  const { specFile, path: p, method, op } = operation
  const label = `${method.toUpperCase()} ${p}`
  const configured = contract.response?.status
  const expected = (
    configured === undefined
      ? [200]
      : typeof configured === 'number'
        ? [configured]
        : [...configured]
  ).sort((a, b) => a - b)
  const documented = Object.keys((op.responses as Json) ?? {})
    .filter(isSuccessStatus)
    .map(Number)
    .sort((a, b) => a - b)

  if (JSON.stringify(documented) !== JSON.stringify(expected)) {
    fail(
      specFile,
      `${label}: documented success statuses [${documented.join(', ')}] do not match contract statuses [${expected.join(', ')}]`
    )
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

  const docBodyContent = ((deref(op.requestBody, spec) as Json)?.content as Json) ?? {}
  if (contract.body) {
    const zodRoot = toJsonSchema(contract.body, 'input')
    if (zodRoot) {
      for (const media of Object.values(docBodyContent)) {
        const docSchema = (media as Json)?.schema
        if (!docSchema) continue
        diffSchemaFields(
          zodRoot,
          zodRoot,
          docSchema,
          spec,
          { specFile, label, name, where: 'body' },
          '',
          0
        )
      }
    }
  }

  if (contract.response?.mode === 'json' && contract.response.schema) {
    const responses = (op.responses as Json) ?? {}
    for (const [status, response] of Object.entries(responses)) {
      if (!isSuccessStatus(status)) continue
      const docResponse = deref(response, spec) as Json | undefined
      const docSchema = ((docResponse?.content as Json)?.['application/json'] as Json)?.schema
      if (docSchema) {
        const responseSchema =
          contract.response.statusSchemas?.[Number(status)] ?? contract.response.schema
        const zodRoot = toJsonSchema(responseSchema, 'output')
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

function documentedExamples(media: Json, spec: Json): Array<[string, unknown]> {
  const candidates: Array<[string, unknown]> = []
  if (media.example !== undefined) candidates.push(['example', media.example])
  for (const [name, rawExample] of Object.entries((media.examples as Json) ?? {})) {
    const example = deref(rawExample, spec) as Json | undefined
    if (example?.value !== undefined) candidates.push([name, example.value])
  }

  const schema = deref(media.schema, spec) as Json | undefined
  if (schema?.example !== undefined) candidates.push(['schema.example', schema.example])
  if (Array.isArray(schema?.examples)) {
    for (const [index, example] of schema.examples.entries()) {
      candidates.push([`schema.examples[${index}]`, example])
    }
  }
  return candidates
}

function checkExamples(operation: Operation, contract: ContractLike, name: string): void {
  const { specFile, path: p, method, op, spec } = operation
  const label = `${method.toUpperCase()} ${p}`

  const bodyContent = ((deref(op.requestBody, spec) as Json)?.content as Json) ?? {}
  if (contract.body) {
    for (const [contentType, rawMedia] of Object.entries(bodyContent)) {
      for (const [exampleName, value] of documentedExamples(rawMedia as Json, spec)) {
        const parsed = contract.body.safeParse(value)
        if (!parsed.success) {
          fail(
            specFile,
            `${label}: ${contentType} request example "${exampleName}" rejected by ${name}: ${parsed.error.issues[0]?.message}`
          )
        }
      }
    }
  }

  if (contract.response?.mode === 'json' && contract.response.schema) {
    const responses = (op.responses as Json) ?? {}
    for (const [status, rawResponse] of Object.entries(responses)) {
      if (!isSuccessStatus(status)) continue
      const response = deref(rawResponse, spec) as Json | undefined
      const content = (response?.content as Json)?.['application/json'] as Json | undefined
      if (!content) continue
      for (const [exampleName, value] of documentedExamples(content, spec)) {
        const responseSchema =
          contract.response.statusSchemas?.[Number(status)] ?? contract.response.schema
        const validationError = outputExampleError(responseSchema, value)
        if (validationError) {
          fail(
            specFile,
            `${label}: ${status} response example "${exampleName}" rejected by ${name}: ${validationError}`
          )
        }
      }
    }
  }
}

const registry = await loadContracts()
const documentedKeys = new Set<string>()
const globalOperationIds = new Map<string, string>()
const globalOperationTags = new Map<string, readonly string[]>()

for (const specFile of SPEC_FILES) {
  const spec = JSON.parse(readFileSync(path.join(DOCS_DIR, specFile), 'utf8')) as Json
  if (spec['x-generated-by'] !== 'scripts/generate-openapi.ts') {
    fail(specFile, 'generated spec is missing its x-generated-by marker')
  }
  const ops = collectOperations(specFile, spec)
  checkIntegrity(specFile, spec, ops)

  for (const operation of ops) {
    const key = `${operation.method.toUpperCase()} ${operation.path}`
    if (documentedKeys.has(key)) {
      fail(specFile, `${key}: operation is documented by more than one spec`)
    }
    documentedKeys.add(key)
    const operationId = operation.op.operationId
    if (typeof operationId === 'string') {
      const previous = globalOperationIds.get(operationId)
      if (previous)
        fail(specFile, `duplicate global operationId "${operationId}" (also in ${previous})`)
      else {
        globalOperationIds.set(operationId, specFile)
        globalOperationTags.set(
          operationId,
          Array.isArray(operation.op.tags)
            ? operation.op.tags.filter((tag): tag is string => typeof tag === 'string')
            : []
        )
      }
    }
    if (!operation.path.startsWith('/api/v2/')) {
      fail(specFile, `${key}: public OpenAPI operations must use the /api/v2/ namespace`)
      continue
    }
    checkV2Conventions(operation)

    const entry = registry.get(key)
    if (!entry) {
      fail(specFile, `${key}: documented but no contract exports this route`)
      continue
    }
    checkSuccessStatuses(operation, entry.contract)
    checkQueryParams(operation, entry.contract, entry.name)
    checkBodyAndResponse(operation, entry.contract, entry.name)
    checkExamples(operation, entry.contract, entry.name)
  }
}

for (const [key, { name }] of registry) {
  if (!documentedKeys.has(key)) {
    errors.push(`registry: ${name} (${key}) is not documented in any OpenAPI spec`)
  }
}

for (const [legacyOperationId, replacement] of Object.entries(LEGACY_CORE_REPLACEMENTS)) {
  if (!documentedKeys.has(replacement)) {
    errors.push(
      `legacy coverage: ${legacyOperationId} is missing its documented v2 replacement (${replacement})`
    )
  }
}

const workflowMetaGroups = [
  {
    tag: 'Workflows',
    file: 'content/docs/en/api-reference/(generated)/workflows/meta.json',
  },
  {
    tag: 'Workflow Runs',
    file: 'content/docs/en/api-reference/(generated)/workflow-runs/meta.json',
  },
] as const
const visibleWorkflowOperationIds = new Set<string>()
for (const group of workflowMetaGroups) {
  const meta = JSON.parse(readFileSync(path.join(DOCS_DIR, group.file), 'utf8')) as Json
  if (!Array.isArray(meta.pages) || !meta.pages.every((page) => typeof page === 'string')) {
    fail(group.file, 'pages must be an array of operationIds')
    continue
  }
  for (const operationId of meta.pages as string[]) {
    if (visibleWorkflowOperationIds.has(operationId)) {
      fail(group.file, `${operationId} is listed in more than one workflow group`)
      continue
    }
    visibleWorkflowOperationIds.add(operationId)
    if (globalOperationIds.get(operationId) !== 'openapi-v2-workflows.json') {
      fail(group.file, `${operationId} is not an operation in openapi-v2-workflows.json`)
      continue
    }
    if (!globalOperationTags.get(operationId)?.includes(group.tag)) {
      fail(group.file, `${operationId} is not tagged ${group.tag}`)
    }
  }
}
for (const [operationId, specFile] of globalOperationIds) {
  if (specFile === 'openapi-v2-workflows.json' && !visibleWorkflowOperationIds.has(operationId)) {
    errors.push(`${operationId} is documented but hidden from the workflow API reference groups`)
  }
}

for (const locale of API_REFERENCE_LOCALES) {
  const metaFile = `content/docs/${locale}/api-reference/meta.json`
  const meta = JSON.parse(readFileSync(path.join(DOCS_DIR, metaFile), 'utf8')) as Json
  if (!Array.isArray(meta.pages) || !meta.pages.every((page) => typeof page === 'string')) {
    fail(metaFile, 'pages must be an array of page identifiers')
    continue
  }
  const pages = new Set(meta.pages as string[])
  for (const group of REQUIRED_API_REFERENCE_GROUPS) {
    if (!pages.has(group)) fail(metaFile, `missing public v2 group ${group}`)
  }
  for (const group of REMOVED_API_REFERENCE_GROUPS) {
    if (pages.has(group)) fail(metaFile, `obsolete legacy group ${group} must not be published`)
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
