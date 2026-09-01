import { filterUndefined } from '@sim/utils/object'
import { DEFAULT_DISPLAY_VALUE } from '@/tools/servicenow/constants'
import type {
  ServiceNowAuthParams,
  ServiceNowEnvelope,
  ServiceNowReadOptions,
  ServiceNowRecord,
  ServiceNowWriteOptions,
} from '@/tools/servicenow/types'

/**
 * Creates a Basic Authentication header from username and password
 * @param username ServiceNow username
 * @param password ServiceNow password
 * @returns Base64 encoded Basic Auth header value
 */
export function createBasicAuthHeader(username: string, password: string): string {
  const credentials = Buffer.from(`${username}:${password}`).toString('base64')
  return `Basic ${credentials}`
}

/**
 * Normalizes a ServiceNow instance URL into an origin without a trailing slash.
 * @throws when the instance URL is missing or blank
 */
export function normalizeInstanceUrl(instanceUrl: string | undefined): string {
  const baseUrl = (instanceUrl ?? '').trim().replace(/\/$/, '')
  if (!baseUrl) {
    throw new Error('ServiceNow instance URL is required')
  }
  return baseUrl
}

/**
 * Builds the Basic Auth + Accept headers every ServiceNow REST call needs.
 * Pass `json` to also declare a JSON request body.
 */
export function buildServiceNowHeaders(
  params: ServiceNowAuthParams,
  options: { json?: boolean } = {}
): Record<string, string> {
  if (!params.username || !params.password) {
    throw new Error('ServiceNow username and password are required')
  }
  const headers: Record<string, string> = {
    Authorization: createBasicAuthHeader(params.username, params.password),
    Accept: 'application/json',
  }
  if (options.json) {
    headers['Content-Type'] = 'application/json'
  }
  return headers
}

/**
 * Appends the Table API read parameters (`sysparm_query`, `sysparm_limit`,
 * `sysparm_offset`, `sysparm_fields`, `sysparm_display_value`) to a query string.
 *
 * `displayValue` defaults to `all` on the semantic tools so reference fields
 * (`assigned_to`, `assignment_group`, `caller_id`, `cmdb_ci`) come back as
 * `{ value: <sys_id>, display_value: <label> }` instead of a bare sys_id.
 */
export function appendReadParams(
  searchParams: URLSearchParams,
  options: ServiceNowReadOptions & { defaultDisplayValue?: string }
): void {
  const { query, limit, offset, fields, displayValue, defaultDisplayValue } = options

  if (query) searchParams.append('sysparm_query', query)
  /**
   * `0` is meaningful on both of these, so emptiness rather than falsiness is
   * the test — a cleared field arrives as `''` and must be omitted, not sent as
   * a valueless `sysparm_limit=`.
   */
  if (limit !== undefined && limit !== null && String(limit) !== '') {
    searchParams.append('sysparm_limit', String(limit))
  }
  if (offset !== undefined && offset !== null && String(offset) !== '') {
    searchParams.append('sysparm_offset', String(offset))
  }
  if (fields) searchParams.append('sysparm_fields', fields)

  const resolvedDisplayValue = displayValue || defaultDisplayValue
  if (resolvedDisplayValue) {
    searchParams.append('sysparm_display_value', resolvedDisplayValue)
  }
}

/**
 * Appends the Table API write parameters (`sysparm_display_value`,
 * `sysparm_input_display_value`, `sysparm_fields`) to a query string.
 *
 * `sysparm_input_display_value=true` lets callers pass a display name (for
 * example `assigned_to: "Beth Anglin"`) and have ServiceNow resolve it to the
 * stored sys_id. It defaults to `false`, meaning reference fields must be sys_ids.
 */
export function appendWriteParams(
  searchParams: URLSearchParams,
  options: ServiceNowWriteOptions & { defaultDisplayValue?: string }
): void {
  const { fields, displayValue, inputDisplayValue, defaultDisplayValue } = options

  if (fields) searchParams.append('sysparm_fields', fields)

  const resolvedDisplayValue = displayValue || defaultDisplayValue
  if (resolvedDisplayValue) {
    searchParams.append('sysparm_display_value', resolvedDisplayValue)
  }
  if (inputDisplayValue === true || inputDisplayValue === 'true') {
    searchParams.append('sysparm_input_display_value', 'true')
  }
}

/**
 * Builds the Table API URL for a single record, applying the shared write
 * parameters. Used by every semantic update tool.
 */
export function buildTableRecordUrl(
  params: ServiceNowAuthParams & ServiceNowWriteOptions & { sysId?: string },
  tableName: string
): string {
  const baseUrl = normalizeInstanceUrl(params.instanceUrl)
  const sysId = params.sysId?.trim()
  if (!sysId) {
    throw new Error('A record sys_id is required')
  }

  const searchParams = new URLSearchParams()
  appendWriteParams(searchParams, { ...params, defaultDisplayValue: DEFAULT_DISPLAY_VALUE })
  return withQueryString(`${baseUrl}/api/now/table/${tableName}/${sysId}`, searchParams)
}

/**
 * Joins a base URL with an already-built query string.
 */
export function withQueryString(url: string, searchParams: URLSearchParams): string {
  const queryString = searchParams.toString()
  return queryString ? `${url}?${queryString}` : url
}

/**
 * Parses a ServiceNow JSON response, raising the instance's own error message
 * when the request failed. ServiceNow error bodies are `{ error: { message, detail } }`.
 */
export async function parseServiceNowResponse(response: Response): Promise<ServiceNowEnvelope> {
  const data = (await response.json()) as ServiceNowEnvelope

  if (!response.ok) {
    throw new Error(serviceNowErrorMessage(data))
  }

  return data
}

/** Pulls the instance's own message out of a `{ error: { message, detail } }` body. */
function serviceNowErrorMessage(data: unknown): string {
  const error = (data as ServiceNowEnvelope)?.error ?? data
  return typeof error === 'string'
    ? error
    : ((error as { message?: string })?.message ?? JSON.stringify(error))
}

/**
 * Raises a failed response's error for an endpoint whose success case has no
 * body to parse — `DELETE`, which answers `204 No Content`, so
 * `parseServiceNowResponse`'s unconditional `response.json()` cannot be used.
 *
 * A failed delete carries the same `{ error: { message } }` envelope as every
 * other endpoint, but a proxy or gateway in front of the instance answers with
 * HTML or with nothing, so both non-JSON and empty bodies fall back rather than
 * surfacing a JSON parse error the caller cannot act on.
 */
export async function throwServiceNowError(response: Response): Promise<never> {
  const statusMessage =
    `ServiceNow request failed (${response.status} ${response.statusText})`.trim()

  const body = (await response.text()).trim()
  if (!body) throw new Error(statusMessage)

  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    throw new Error(body)
  }
  throw new Error(serviceNowErrorMessage(parsed))
}

/**
 * Narrows an envelope `result` to a keyed record. Single-record endpoints reply
 * with an object; anything else (a collection, a scalar, `null`) becomes `{}` so
 * callers can read fields without an unchecked cast.
 */
export function toRecordObject(result: unknown): ServiceNowRecord {
  return isRecord(result) ? result : {}
}

/**
 * Reads a string field off a ServiceNow record. Returns `null` when the field is
 * absent or is not a string, so a tool declaring a `string | null` output cannot
 * silently emit an object because the instance returned a different shape.
 */
export function readString(record: ServiceNowRecord, key: string): string | null {
  const value = record[key]
  return typeof value === 'string' ? value : null
}

/**
 * Reads a nested object off a ServiceNow record, returning `null` when the field
 * is absent or is not a plain object. Keeps a tool declaring an object-shaped
 * output from emitting a scalar because the instance returned a different shape.
 */
export function readRecord(record: ServiceNowRecord, key: string): ServiceNowRecord | null {
  const value = record[key]
  return isRecord(value) ? value : null
}

/**
 * Reads an array of nested objects off a ServiceNow record, dropping any entry
 * that is not a plain object. Absent or non-array fields become an empty array.
 */
export function readRecordArray(record: ServiceNowRecord, key: string): ServiceNowRecord[] {
  const value = record[key]
  return Array.isArray(value) ? value.filter(isRecord) : []
}

/**
 * Reads a number field off a nested object on a ServiceNow record, for example
 * the `meta.count` the Knowledge search API returns alongside its results.
 */
export function readNestedNumber(
  record: ServiceNowRecord,
  key: string,
  nestedKey: string
): number | null {
  const nested = toRecordObject(record[key])[nestedKey]
  return typeof nested === 'number' ? nested : null
}

/**
 * Normalizes the `{ result: ... }` envelope into an array of records. Collection
 * endpoints return an array, single-record endpoints return an object.
 *
 * Members that are not plain objects are dropped rather than cast. Every tool
 * built on this declares an object-shaped `records`/`record` output, so passing
 * a `null` or a scalar straight through would report success while handing the
 * next block a value its declared contract says cannot occur.
 */
export function toRecordArray(result: unknown): ServiceNowRecord[] {
  if (result === null || result === undefined) return []
  return (Array.isArray(result) ? result : [result]).filter(isRecord)
}

/** Narrows an unknown value to a plain (non-array, non-null) object. */
export function isRecord(value: unknown): value is ServiceNowRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Shared `transformResponse` for tools that return a list of records.
 */
export async function transformRecordListResponse(response: Response) {
  const data = await parseServiceNowResponse(response)
  const records = toRecordArray(data.result)

  return {
    success: true as const,
    output: {
      records,
      metadata: { recordCount: records.length },
    },
  }
}

/**
 * Shared `transformResponse` for tools that return exactly one record.
 */
export async function transformRecordResponse(response: Response) {
  const data = await parseServiceNowResponse(response)
  const record = toRecordArray(data.result)[0] ?? null

  return {
    success: true as const,
    output: {
      record,
      metadata: { recordCount: record ? 1 : 0 },
    },
  }
}

/**
 * Merges the explicit named field params of a semantic tool with the
 * `additionalFields` escape hatch, dropping undefined and empty values so a
 * blank optional input never overwrites an existing ServiceNow field.
 */
export function buildFieldPayload(
  named: Record<string, unknown>,
  additionalFields?: Record<string, unknown> | string
): Record<string, unknown> {
  const cleaned = filterUndefined(named)
  for (const key of Object.keys(cleaned)) {
    if (cleaned[key] === '' || cleaned[key] === null) delete cleaned[key]
  }

  let extra: Record<string, unknown> = {}
  if (typeof additionalFields === 'string' && additionalFields.trim()) {
    const parsed = JSON.parse(additionalFields)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('additionalFields must be a JSON object')
    }
    extra = parsed as Record<string, unknown>
  } else if (additionalFields && typeof additionalFields === 'object') {
    extra = additionalFields as Record<string, unknown>
  }

  const payload = { ...cleaned, ...extra }
  if (Object.keys(payload).length === 0) {
    throw new Error('At least one field must be provided')
  }
  return payload
}

/**
 * ANDs a set of optional `field=value` clauses into a single ServiceNow encoded
 * query, dropping blanks. Caller-supplied encoded queries are appended last.
 */
export function buildEncodedQuery(
  clauses: Array<[field: string, operator: string, value: unknown]>,
  extraQuery?: string
): string | undefined {
  const parts: string[] = []

  for (const [field, operator, value] of clauses) {
    if (value === undefined || value === null || value === '') continue
    parts.push(`${field}${operator}${String(value).trim()}`)
  }

  if (extraQuery?.trim()) parts.push(extraQuery.trim())

  return parts.length > 0 ? parts.join('^') : undefined
}

/**
 * Builds the `sysparm_query` that identifies a record by sys_id or number, ANDed
 * with an optional caller-supplied encoded query.
 * @throws when neither identifier is supplied
 */
export function buildIdentifierQuery(
  identifiers: { sysId?: string; number?: string },
  extraQuery?: string
): string {
  const sysId = identifiers.sysId?.trim()
  const number = identifiers.number?.trim()

  if (!sysId && !number) {
    throw new Error('Either a sys_id or a record number is required')
  }

  const clauses = [sysId ? `sys_id=${sysId}` : `number=${number}`]
  if (extraQuery) clauses.push(extraQuery)
  return clauses.join('^')
}
