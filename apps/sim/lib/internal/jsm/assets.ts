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
import { asArray, createJsmAssetsClient } from '@/lib/internal/jsm/client'
import { mapAssetObject } from '@/tools/jsm/utils'

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
  const values = asArray(data.values)
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

export async function executeJsmListObjectTypes(input: ListObjectTypesInput, signal?: AbortSignal) {
  const client = await createJsmAssetsClient(input, signal)
  const query = new URLSearchParams()
  if (input.excludeAbstract !== undefined) {
    query.append('excludeAbstract', String(input.excludeAbstract))
  }
  const value = await client.value(
    client.assets(
      `/objectschema/${encodeURIComponent(input.schemaId)}/objecttypes${query.size ? `?${query}` : ''}`
    ),
    {},
    signal,
    true
  )
  const data = Array.isArray(value) ? {} : (value as Record<string, unknown>)
  const objectTypes = Array.isArray(value) ? value : asArray(data.values)
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
  const attributes = Array.isArray(value) ? value : asArray(data.values)
  return {
    success: true,
    output: { ts: new Date().toISOString(), attributes, total: attributes.length },
  }
}

export async function executeJsmSearchObjectsAql(
  input: SearchObjectsAqlInput,
  signal?: AbortSignal
) {
  const client = await createJsmAssetsClient(input, signal)
  const includeAttributes =
    input.includeAttributes === undefined ? true : String(input.includeAttributes) === 'true'
  const body: Record<string, unknown> = {
    qlQuery: input.qlQuery,
    page: toNumber(input.page, 1),
    resultsPerPage: toNumber(input.resultsPerPage, 25),
    includeAttributes,
  }
  if (input.objectTypeId) body.objectTypeId = input.objectTypeId
  if (input.objectSchemaId) body.objectSchemaId = input.objectSchemaId
  const data = await client.json(client.assets('/object/aql'), jsonBody('POST', body), signal, true)
  const entries = asArray(data.objectEntries)
  return {
    success: true,
    output: {
      ts: new Date().toISOString(),
      objects: entries.map((entry) =>
        mapAssetObject(entry as Parameters<typeof mapAssetObject>[0])
      ),
      total: data.totalFilterCount ?? entries.length,
      pageNumber: data.pageNumber ?? 1,
      pageSize: data.pageSize ?? entries.length,
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
