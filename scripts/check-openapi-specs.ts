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
 * 3. Contract cross-check: every route contract anywhere under
 *    `lib/api/contracts/**` whose path is under `/api/v2/` must be documented
 *    (or listed in `UNDOCUMENTED_V2_ROUTES` with a reason), every documented
 *    `/api/v2/` operation must have a contract, and for each pair the query
 *    params, body fields, and response fields are diffed via
 *    `z.toJSONSchema`. The sweep is recursive and rooted at the whole
 *    contracts tree, not the flat `v2/` directory — a contract in a
 *    subdirectory, or one that lives beside its non-v2 siblings, must never
 *    be able to escape coverage by virtue of where its file sits.
 * 4. Examples, against two independent authorities:
 *    a. The RUNTIME CONTRACT — request examples are parsed with the matching
 *       contract's Zod body schema and response examples against its Zod
 *       response schema, so a doc example the running API would reject fails
 *       the build.
 *    b. The PUBLISHED SCHEMA — every example node in the serialized document,
 *       at any depth and on any status, is validated with Ajv against the
 *       exact JSON Schema readers see, with formats enforced. Zod is not
 *       consulted, so generator lossiness (a dropped regex flag, a bound
 *       erased by `.transform()`, a malformed `date-time`) surfaces here
 *       instead of shipping invisibly.
 *
 *    The two are complementary and their failures name their authority:
 *    a runtime-contract failure means the example is wrong; a published-schema
 *    failure means either the example or the generated schema is wrong.
 */

import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import Ajv2020 from 'ajv/dist/2020'
import { z } from 'zod'
import { OPENAPI_SPEC_FILES } from '../apps/docs/lib/openapi-specs'

const ROOT = path.resolve(import.meta.dir, '..')
const DOCS_DIR = path.join(ROOT, 'apps/docs')
const CONTRACTS_DIR = path.join(ROOT, 'apps/sim/lib/api/contracts')

const SPEC_FILES = OPENAPI_SPEC_FILES

/**
 * `/api/v2/` routes that are deliberately absent from the public OpenAPI
 * specs, each with the reason it is not public API surface. Anything not
 * listed here fails the build, so an undocumented v2 route is always a
 * conscious, reviewed decision rather than an accident of file layout.
 *
 * A stale entry — one whose contract no longer exists, or which has since
 * been documented — also fails, so the list cannot rot into a blanket
 * exemption.
 *
 * Being unpublished is about *addressability*, not about behaviour: both
 * entries below answer in the canonical `{ error: { code, message } }` envelope
 * like every documented route, and what a caller needs in order to perform the
 * transfer is published on `transfer.url` in `contracts/v2/uploads.ts`.
 */
const UNDOCUMENTED_V2_ROUTES: Readonly<Record<string, string>> = {
  'PUT /api/v2/uploads/{uploadId}':
    'Local-storage data plane for a signed whole-object upload. Authenticated by the short-lived upload-token minted by the documented session-create operation, not by an API key, so it carries neither the v2 API-key security scheme nor the rate-limit and feature-gate responses `checkV2Conventions` requires of a published operation. On a cloud deployment the same field points at object storage instead, so the endpoint is described by `transfer.url` — which publishes its method, headers, success status, and error codes — rather than by an operation of its own.',
  'PUT /api/v2/uploads/{uploadId}/parts/{partNumber}':
    'Local-storage data plane for a signed multipart part upload. Authenticated by a per-part signed `token` query param minted by the documented part-URL operation, not by an API key; same reasoning and same published `transfer.url` contract as the whole-object PUT above.',
}

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

/** Every non-test `.ts` file under `dir`, recursively, in stable order. */
function listContractFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name)
  )) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue
      files.push(...listContractFiles(full))
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      files.push(full)
    }
  }
  return files
}

/** Every `/api/v2/` route contract exported anywhere in the contracts tree. */
async function loadContracts(): Promise<Map<string, { name: string; contract: ContractLike }>> {
  const registry = new Map<string, { name: string; contract: ContractLike }>()
  for (const file of listContractFiles(CONTRACTS_DIR)) {
    const mod = (await import(file)) as Record<string, unknown>
    for (const [name, value] of Object.entries(mod)) {
      if (!isContract(value)) continue
      if (!value.path.startsWith('/api/v2/')) continue
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

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const
const RFC3339_DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:[Zz]|[+-]\d{2}:\d{2})$/

/**
 * Strict RFC 3339 `date-time`. Ajv ships no format implementations of its own,
 * so the published-schema pass registers the formats the specs actually use
 * rather than depending on a transitive `ajv-formats` copy that resolves
 * against a different Ajv build.
 *
 * `Date.parse` cannot stand in for the day bound: the ECMAScript Date Time
 * String Format grammar accepts `DD` up to 31 and `MakeDay` silently rolls the
 * overflow forward, so `2025-02-29` and `2025-04-31` both parse to a valid
 * instant instead of `NaN`. February therefore carries the proleptic Gregorian
 * leap rule explicitly. `:60` is allowed on purpose — RFC 3339 §5.6 permits a
 * leap second in the `time-second` position.
 */
function isRfc3339DateTime(value: string): boolean {
  const match = RFC3339_DATE_TIME.exec(value)
  if (!match) return false
  const [, year, month, day, hour, minute, second] = match.map(Number)
  if (month < 1 || month > 12) return false
  const leapYear = month === 2 && year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  if (day < 1 || day > DAYS_IN_MONTH[month - 1] + (leapYear ? 1 : 0)) return false
  return hour <= 23 && minute <= 59 && second <= 60
}

const publishedExampleValidator = new Ajv2020({
  strict: false,
  allErrors: true,
  validateFormats: true,
  validateSchema: false,
})
publishedExampleValidator.addFormat('date-time', isRfc3339DateTime)
publishedExampleValidator.addFormat('email', /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/)
publishedExampleValidator.addFormat('uri', /^[A-Za-z][A-Za-z0-9+\-.]*:\S*$/)
/** OpenAPI content encodings, not JSON Schema assertions — annotation only. */
publishedExampleValidator.addFormat('binary', true)
publishedExampleValidator.addFormat('csv', true)

const pointerToken = (token: string) => token.replace(/~/g, '~0').replace(/\//g, '~1')

/** JSON Schema keywords whose value is a single subschema. */
const SUBSCHEMA_KEYWORDS = [
  'items',
  'not',
  'contains',
  'propertyNames',
  'if',
  'then',
  'else',
  'additionalProperties',
  'unevaluatedItems',
  'unevaluatedProperties',
] as const
/** JSON Schema keywords whose value is a name → subschema map. */
const SUBSCHEMA_MAP_KEYWORDS = [
  'properties',
  'patternProperties',
  '$defs',
  'definitions',
  'dependentSchemas',
] as const
/** JSON Schema keywords whose value is an array of subschemas. */
const SUBSCHEMA_LIST_KEYWORDS = ['allOf', 'anyOf', 'oneOf', 'prefixItems'] as const

interface PublishedExample {
  /** Human-readable location, e.g. `POST /api/v2/tables 201 application/json`. */
  label: string
  /** Name of the example within that location. */
  exampleName: string
  /** JSON pointer to the schema the example must satisfy. */
  schemaPointer: string
  value: unknown
}

/**
 * Every `example` / `examples` annotation inside a JSON Schema subtree,
 * including nested `properties/*`, array items, and composition branches.
 * Recursion follows JSON Schema keywords only, so an example's own payload is
 * never mistaken for a schema.
 */
function collectSchemaExamples(
  node: unknown,
  pointer: string,
  label: string,
  out: PublishedExample[]
): void {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return
  const record = node as Json
  if (record.example !== undefined) {
    out.push({
      label,
      exampleName: 'schema.example',
      schemaPointer: pointer,
      value: record.example,
    })
  }
  if (Array.isArray(record.examples)) {
    for (const [index, value] of record.examples.entries()) {
      out.push({
        label,
        exampleName: `schema.examples[${index}]`,
        schemaPointer: pointer,
        value,
      })
    }
  }
  for (const keyword of SUBSCHEMA_KEYWORDS) {
    if (record[keyword] !== undefined) {
      collectSchemaExamples(record[keyword], `${pointer}/${keyword}`, `${label}.${keyword}`, out)
    }
  }
  for (const keyword of SUBSCHEMA_MAP_KEYWORDS) {
    const map = record[keyword]
    if (!map || typeof map !== 'object' || Array.isArray(map)) continue
    for (const [name, sub] of Object.entries(map as Json)) {
      collectSchemaExamples(
        sub,
        `${pointer}/${keyword}/${pointerToken(name)}`,
        `${label}.${name}`,
        out
      )
    }
  }
  for (const keyword of SUBSCHEMA_LIST_KEYWORDS) {
    const list = record[keyword]
    if (!Array.isArray(list)) continue
    for (const [index, sub] of list.entries()) {
      collectSchemaExamples(
        sub,
        `${pointer}/${keyword}/${index}`,
        `${label}.${keyword}[${index}]`,
        out
      )
    }
  }
}

/**
 * Examples on a Media Type, Parameter, or Header Object, all of which carry
 * `example` / `examples` beside the `schema` those examples must satisfy.
 */
function collectSchemaHolderExamples(
  holder: unknown,
  pointer: string,
  label: string,
  spec: Json,
  out: PublishedExample[]
): void {
  if (!holder || typeof holder !== 'object' || Array.isArray(holder)) return
  const record = holder as Json
  if (record.schema === undefined) return
  const schemaPointer = `${pointer}/schema`
  if (record.example !== undefined) {
    out.push({ label, exampleName: 'example', schemaPointer, value: record.example })
  }
  for (const [name, raw] of Object.entries((record.examples as Json) ?? {})) {
    const example = deref(raw, spec) as Json | undefined
    if (example?.value !== undefined) {
      out.push({ label, exampleName: name, schemaPointer, value: example.value })
    }
  }
  collectSchemaExamples(record.schema, schemaPointer, label, out)
}

function collectContentExamples(
  content: unknown,
  pointer: string,
  label: string,
  spec: Json,
  out: PublishedExample[]
): void {
  if (!content || typeof content !== 'object') return
  for (const [contentType, media] of Object.entries(content as Json)) {
    collectSchemaHolderExamples(
      media,
      `${pointer}/${pointerToken(contentType)}`,
      `${label} ${contentType}`,
      spec,
      out
    )
  }
}

function collectParameterExamples(
  parameters: unknown,
  pointer: string,
  label: string,
  spec: Json,
  out: PublishedExample[]
): void {
  if (!Array.isArray(parameters)) return
  for (const [index, raw] of parameters.entries()) {
    // A `$ref`d parameter is walked once at its definition site instead.
    if (!raw || typeof raw !== 'object' || typeof (raw as Json).$ref === 'string') continue
    const name = (raw as Json).name
    collectSchemaHolderExamples(
      raw,
      `${pointer}/${index}`,
      `${label} parameter "${typeof name === 'string' ? name : index}"`,
      spec,
      out
    )
  }
}

/**
 * Every example node in the serialized document, reached structurally rather
 * than through the contract registry: component schemas at any depth, shared
 * responses and their error envelopes, and every operation's parameters,
 * request body, and responses at every status — 4xx and 5xx included.
 *
 * `$ref`d containers are deliberately not followed here; each is walked once
 * at its definition site, so no example is validated twice.
 */
function collectPublishedExamples(spec: Json): PublishedExample[] {
  const out: PublishedExample[] = []
  const components = (spec.components as Json) ?? {}

  for (const [name, schema] of Object.entries((components.schemas as Json) ?? {})) {
    collectSchemaExamples(
      schema,
      `/components/schemas/${pointerToken(name)}`,
      `components.schemas.${name}`,
      out
    )
  }
  for (const section of ['parameters', 'headers'] as const) {
    for (const [name, holder] of Object.entries((components[section] as Json) ?? {})) {
      collectSchemaHolderExamples(
        holder,
        `/components/${section}/${pointerToken(name)}`,
        `components.${section}.${name}`,
        spec,
        out
      )
    }
  }
  for (const section of ['requestBodies', 'responses'] as const) {
    for (const [name, holder] of Object.entries((components[section] as Json) ?? {})) {
      collectContentExamples(
        (holder as Json)?.content,
        `/components/${section}/${pointerToken(name)}/content`,
        `components.${section}.${name}`,
        spec,
        out
      )
    }
  }

  for (const [p, rawItem] of Object.entries((spec.paths as Json) ?? {})) {
    if (!rawItem || typeof rawItem !== 'object') continue
    const item = rawItem as Json
    const itemPointer = `/paths/${pointerToken(p)}`
    collectParameterExamples(item.parameters, `${itemPointer}/parameters`, p, spec, out)
    for (const [method, rawOp] of Object.entries(item)) {
      if (!HTTP_METHODS.has(method) || !rawOp || typeof rawOp !== 'object') continue
      const op = rawOp as Json
      const opPointer = `${itemPointer}/${method}`
      const label = `${method.toUpperCase()} ${p}`
      collectParameterExamples(op.parameters, `${opPointer}/parameters`, label, spec, out)
      if (op.requestBody && typeof (op.requestBody as Json).$ref !== 'string') {
        collectContentExamples(
          (op.requestBody as Json).content,
          `${opPointer}/requestBody/content`,
          `${label} request`,
          spec,
          out
        )
      }
      for (const [status, rawResponse] of Object.entries((op.responses as Json) ?? {})) {
        if (!rawResponse || typeof rawResponse !== 'object') continue
        if (typeof (rawResponse as Json).$ref === 'string') continue
        collectContentExamples(
          (rawResponse as Json).content,
          `${opPointer}/responses/${pointerToken(status)}/content`,
          `${label} ${status}`,
          spec,
          out
        )
      }
    }
  }
  return out
}

let publishedExamplesRead = 0
let runtimeExamplesRead = 0

/**
 * Validates every collected example against the published document itself.
 * The whole spec is registered under a synthetic URI so `$ref` and `$defs`
 * resolve exactly as a reader's tooling would resolve them.
 */
function checkPublishedExamples(specFile: string, spec: Json): void {
  const specUri = `https://sim.local/openapi/${specFile}`
  if (!publishedExampleValidator.getSchema(specUri)) {
    publishedExampleValidator.addSchema(spec, specUri)
  }
  const validators = new Map<string, ReturnType<typeof publishedExampleValidator.compile>>()
  for (const example of collectPublishedExamples(spec)) {
    publishedExamplesRead++
    let validate = validators.get(example.schemaPointer)
    if (!validate) {
      validate = publishedExampleValidator.compile({ $ref: `${specUri}#${example.schemaPointer}` })
      validators.set(example.schemaPointer, validate)
    }
    if (validate(example.value)) continue
    fail(
      specFile,
      `${example.label}: example "${example.exampleName}" is rejected by the PUBLISHED JSON Schema at #${example.schemaPointer} — ${publishedExampleValidator.errorsText(validate.errors)}. Either the example is wrong or the generated schema is (a lost regex flag, a bound erased by .transform(), a malformed format value).`
    )
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
        runtimeExamplesRead++
        const parsed = contract.body.safeParse(value)
        if (!parsed.success) {
          fail(
            specFile,
            `${label}: ${contentType} request example "${exampleName}" is rejected by the RUNTIME CONTRACT ${name} (Zod) — ${parsed.error.issues[0]?.message}. The running API would reject this request, so fix the example.`
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
        runtimeExamplesRead++
        const responseSchema =
          contract.response.statusSchemas?.[Number(status)] ?? contract.response.schema
        const validationError = outputExampleError(responseSchema, value)
        if (validationError) {
          fail(
            specFile,
            `${label}: ${status} response example "${exampleName}" is rejected by the RUNTIME CONTRACT ${name} (Zod) — ${validationError}. The running API would never emit this body, so fix the example.`
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
  checkPublishedExamples(specFile, spec)

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
  if (documentedKeys.has(key) || key in UNDOCUMENTED_V2_ROUTES) continue
  errors.push(`registry: ${name} (${key}) is not documented in any OpenAPI spec`)
}

for (const [key, reason] of Object.entries(UNDOCUMENTED_V2_ROUTES)) {
  if (!reason.trim()) {
    errors.push(`undocumented v2 allowlist: ${key} needs a reason explaining why it is not public`)
  }
  if (!registry.has(key)) {
    errors.push(`undocumented v2 allowlist: ${key} matches no contract — remove the stale entry`)
  } else if (documentedKeys.has(key)) {
    errors.push(
      `undocumented v2 allowlist: ${key} is documented after all — remove it from the allowlist`
    )
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

const exampleCoverage = `${publishedExamplesRead} examples validated against the published JSON Schema, ${runtimeExamplesRead} against the runtime Zod contracts`

if (errors.length > 0) {
  console.error(
    `OpenAPI spec validation failed (${errors.length} issue${errors.length === 1 ? '' : 's'}; ${exampleCoverage}):`
  )
  for (const message of errors) console.error(`  - ${message}`)
  process.exit(1)
}
const exemptCount = Object.keys(UNDOCUMENTED_V2_ROUTES).length
console.log(
  `OpenAPI spec validation passed: ${SPEC_FILES.length} specs, ${documentedKeys.size} operations, ${registry.size} contracts cross-checked (${exemptCount} explicitly undocumented); ${exampleCoverage}.`
)
