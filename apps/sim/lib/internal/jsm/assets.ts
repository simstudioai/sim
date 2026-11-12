import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { toArray, toRecord } from '@sim/utils/object'
import type { ContractBody } from '@/lib/api/contracts'
import type {
  jsmCreateObjectContract,
  jsmDeleteObjectContract,
  jsmGetObjectContract,
  jsmGetObjectSchemaContract,
  jsmListObjectSchemasContract,
  jsmListObjectTypesContract,
  jsmObjectTypeAttributesContract,
  jsmSearchObjectsAqlContract,
  jsmUpdateObjectContract,
} from '@/lib/api/contracts/tools/jsm'
import { createJsmAssetsClient } from '@/lib/internal/jsm/client'
import { JsmOperationError } from '@/lib/internal/jsm/errors'
import { mapAssetObject } from '@/tools/jsm/utils'

const logger = createLogger('JsmAssets')

type ListObjectSchemasInput = ContractBody<typeof jsmListObjectSchemasContract>
type GetObjectSchemaInput = ContractBody<typeof jsmGetObjectSchemaContract>
type ListObjectTypesInput = ContractBody<typeof jsmListObjectTypesContract>
type ObjectTypeAttributesInput = ContractBody<typeof jsmObjectTypeAttributesContract>
type SearchObjectsAqlInput = ContractBody<typeof jsmSearchObjectsAqlContract>
type GetObjectInput = ContractBody<typeof jsmGetObjectContract>
type CreateObjectInput = ContractBody<typeof jsmCreateObjectContract>
type UpdateObjectInput = ContractBody<typeof jsmUpdateObjectContract>
type DeleteObjectInput = ContractBody<typeof jsmDeleteObjectContract>

function jsonBody(method: 'POST' | 'PUT', body: unknown): RequestInit {
  return { method, body: JSON.stringify(body) }
}

function toNumber(value: string | number | undefined, fallback: number): number {
  if (value === undefined) return fallback
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export async function executeJsmListObjectSchemas(
  input: ListObjectSchemasInput,
  signal?: AbortSignal
) {
  const client = await createJsmAssetsClient(input, signal)
  const query = new URLSearchParams()
  if (input.startAt !== undefined) query.append('startAt', String(input.startAt))
  if (input.maxResults !== undefined) query.append('maxResults', String(input.maxResults))
  if (input.includeCounts !== undefined) {
    query.append('includeCounts', String(input.includeCounts))
  }
  const data = await client.json(
    client.assets(`/objectschema/list${query.size ? `?${query}` : ''}`),
    {},
    signal,
    true
  )
  const values = toArray(data.values)
  return {
    success: true,
    output: {
      ts: new Date().toISOString(),
      schemas: values,
      total: data.total ?? values.length,
      isLast: data.isLast ?? data.last ?? true,
    },
  }
}

export async function executeJsmGetObjectSchema(input: GetObjectSchemaInput, signal?: AbortSignal) {
  const client = await createJsmAssetsClient(input, signal)
  const schema = await client.value(
    client.assets(`/objectschema/${encodeURIComponent(input.schemaId)}`),
    {},
    signal,
    true
  )
  return { success: true, output: { ts: new Date().toISOString(), schema: schema ?? null } }
}

/** Accepts an object-types listing as a bare array or a `values` wrapper. */
function toObjectTypeList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : toArray(toRecord(value).values)
}

function isAbort(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')
}

/**
 * Reads the flat object-types listing used as a fallback for an empty schema listing.
 * A failure other than an abort yields an empty list, so the fallback never fails a
 * request the primary listing already answered.
 */
async function listFlatObjectTypes(
  client: Awaited<ReturnType<typeof createJsmAssetsClient>>,
  schemaPath: string,
  schemaId: string,
  signal?: AbortSignal
): Promise<unknown[]> {
  try {
    return toObjectTypeList(
      await client.value(client.assets(`${schemaPath}/flat`), {}, signal, true)
    )
  } catch (error) {
    if (isAbort(error, signal)) throw error
    logger.warn('Flat object-types fallback failed, returning the empty schema listing', {
      schemaId,
      error: getErrorMessage(error),
    })
    return []
  }
}

/**
 * Lists a schema's object types. An empty schema listing is retried against the
 * documented `/flat` listing, which returns every type in the schema, with
 * `excludeAbstract` applied client-side because `/flat` does not accept it.
 */
export async function executeJsmListObjectTypes(input: ListObjectTypesInput, signal?: AbortSignal) {
  const client = await createJsmAssetsClient(input, signal)
  const query = new URLSearchParams()
  if (input.excludeAbstract !== undefined) {
    query.append('excludeAbstract', String(input.excludeAbstract))
  }
  const schemaPath = `/objectschema/${encodeURIComponent(input.schemaId)}/objecttypes`
  let objectTypes = toObjectTypeList(
    await client.value(
      client.assets(`${schemaPath}${query.size ? `?${query}` : ''}`),
      {},
      signal,
      true
    )
  )
  if (objectTypes.length === 0) {
    const flat = await listFlatObjectTypes(client, schemaPath, input.schemaId, signal)
    objectTypes =
      String(input.excludeAbstract) === 'true'
        ? flat.filter((objectType) => toRecord(objectType).abstractObjectType !== true)
        : flat
  }
  return {
    success: true,
    output: { ts: new Date().toISOString(), objectTypes, total: objectTypes.length },
  }
}

export async function executeJsmGetObjectTypeAttributes(
  input: ObjectTypeAttributesInput,
  signal?: AbortSignal
) {
  const client = await createJsmAssetsClient(input, signal)
  const query = new URLSearchParams()
  if (input.onlyValueEditable !== undefined) {
    query.append('onlyValueEditable', String(input.onlyValueEditable))
  }
  if (input.query) query.append('query', input.query)
  const value = await client.value(
    client.assets(
      `/objecttype/${encodeURIComponent(input.objectTypeId)}/attributes${query.size ? `?${query}` : ''}`
    ),
    {},
    signal,
    true
  )
  const data = Array.isArray(value) ? {} : (value as Record<string, unknown>)
  const attributes = Array.isArray(value) ? value : toArray(data.values)
  return {
    success: true,
    output: { ts: new Date().toISOString(), attributes, total: attributes.length },
  }
}

const ASSETS_NUMERIC_ID = /^\d+$/

const AQL_ORDER_BY = /order\s+by\s/iy
const AQL_CLAUSE_BOUNDARY = /[\s)"]/

/**
 * Splits a trailing `order by` clause off an AQL query, since AQL requires the ordering
 * to stay at the end. Only a clause at parenthesis depth 0 and outside double-quoted
 * values (including escaped `\\"`) counts, so `order by` inside a function argument or
 * a string stays in the condition.
 */
function splitAqlOrderBy(qlQuery: string): { condition: string; orderBy: string } {
  let inQuotes = false
  let depth = 0
  let orderByStart = -1
  for (let index = 0; index < qlQuery.length; index++) {
    const char = qlQuery[index]
    if (char === '"') {
      let backslashes = 0
      for (let cursor = index - 1; cursor >= 0 && qlQuery[cursor] === '\\'; cursor--) backslashes++
      if (backslashes % 2 === 0) inQuotes = !inQuotes
      continue
    }
    if (inQuotes) continue
    if (char === '(') depth++
    else if (char === ')') depth = Math.max(0, depth - 1)
    if (depth !== 0) continue
    if (index > 0 && !AQL_CLAUSE_BOUNDARY.test(qlQuery[index - 1] ?? '')) continue
    AQL_ORDER_BY.lastIndex = index
    if (AQL_ORDER_BY.test(qlQuery)) orderByStart = index
  }
  if (orderByStart === -1) return { condition: qlQuery, orderBy: '' }
  return { condition: qlQuery.slice(0, orderByStart), orderBy: qlQuery.slice(orderByStart) }
}

function scopeId(keyword: string, id: string | undefined): string | null {
  const trimmed = id?.trim()
  if (!trimmed) return null
  if (!ASSETS_NUMERIC_ID.test(trimmed)) {
    throw new JsmOperationError(`${keyword} must be a numeric ID`, 400)
  }
  return `${keyword} = ${trimmed}`
}

/** ANDs the optional object type and schema scopes into the query's condition. */
function scopeAqlQuery(input: SearchObjectsAqlInput): string {
  const scopes = [
    scopeId('objectTypeId', input.objectTypeId),
    scopeId('objectSchemaId', input.objectSchemaId),
  ].filter((scope): scope is string => scope !== null)
  if (scopes.length === 0) return input.qlQuery
  const { condition, orderBy } = splitAqlOrderBy(input.qlQuery)
  const trimmedCondition = condition.trim()
  const scoped = trimmedCondition
    ? `(${trimmedCondition}) AND ${scopes.join(' AND ')}`
    : scopes.join(' AND ')
  return orderBy ? `${scoped} ${orderBy}` : scoped
}

export async function executeJsmSearchObjectsAql(
  input: SearchObjectsAqlInput,
  signal?: AbortSignal
) {
  const page = Math.max(1, Math.trunc(toNumber(input.page, 1)))
  const resultsPerPage = Math.max(1, Math.trunc(toNumber(input.resultsPerPage, 25)))
  const includeAttributes =
    input.includeAttributes === undefined ? true : String(input.includeAttributes) === 'true'
  const qlQuery = scopeAqlQuery(input)
  const client = await createJsmAssetsClient(input, signal)
  const query = new URLSearchParams({
    startAt: String((page - 1) * resultsPerPage),
    maxResults: String(resultsPerPage),
    includeAttributes: String(includeAttributes),
  })
  const data = await client.json(
    client.assets(`/object/aql?${query}`),
    jsonBody('POST', { qlQuery }),
    signal,
    true
  )
  const entries = toArray(data.values)
  const isLast = data.isLast === undefined ? undefined : String(data.isLast) === 'true'
  return {
    success: true,
    output: {
      ts: new Date().toISOString(),
      objects: entries.map((entry) =>
        mapAssetObject(entry as Parameters<typeof mapAssetObject>[0])
      ),
      total: data.total ?? entries.length,
      pageNumber: page,
      pageSize: entries.length,
      startAt: data.startAt ?? (page - 1) * resultsPerPage,
      maxResults: data.maxResults ?? resultsPerPage,
      isLast: isLast ?? entries.length < resultsPerPage,
    },
  }
}

async function assetObject(
  input: GetObjectInput | CreateObjectInput | UpdateObjectInput,
  path: string,
  init: RequestInit,
  signal?: AbortSignal
) {
  const client = await createJsmAssetsClient(input, signal)
  const data = await client.json(client.assets(path), init, signal, true)
  return {
    success: true,
    output: {
      ts: new Date().toISOString(),
      object: mapAssetObject(data as typeof data & Parameters<typeof mapAssetObject>[0]),
    },
  }
}

export function executeJsmGetObject(input: GetObjectInput, signal?: AbortSignal) {
  return assetObject(input, `/object/${encodeURIComponent(input.objectId)}`, {}, signal)
}

export function executeJsmCreateObject(input: CreateObjectInput, signal?: AbortSignal) {
  return assetObject(
    input,
    '/object/create',
    jsonBody('POST', { objectTypeId: input.objectTypeId, attributes: input.attributes }),
    signal
  )
}

export function executeJsmUpdateObject(input: UpdateObjectInput, signal?: AbortSignal) {
  const body: Record<string, unknown> = { attributes: input.attributes }
  if (input.objectTypeId) body.objectTypeId = input.objectTypeId
  return assetObject(
    input,
    `/object/${encodeURIComponent(input.objectId)}`,
    jsonBody('PUT', body),
    signal
  )
}

export async function executeJsmDeleteObject(input: DeleteObjectInput, signal?: AbortSignal) {
  const client = await createJsmAssetsClient(input, signal)
  await client.empty(
    client.assets(`/object/${encodeURIComponent(input.objectId)}`),
    { method: 'DELETE' },
    signal,
    true
  )
  return {
    success: true,
    output: { ts: new Date().toISOString(), objectId: input.objectId, deleted: true },
  }
}
