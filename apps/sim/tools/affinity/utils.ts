import type {
  AffinityAcknowledgementResponse,
  AffinityCollectionResponse,
  AffinityEntityResponse,
  AffinityKeywordSearchResponse,
  AffinityPagination,
} from '@/tools/affinity/types'

/** Affinity API v2 origin. Every documented v2 endpoint hangs off this base. */
const AFFINITY_API_BASE = 'https://api.affinity.co/v2'

/**
 * Entity families that expose the shared non-list field endpoints
 * (`/v2/{entityType}/fields` and `/v2/{entityType}/{id}/fields`).
 */
export const AFFINITY_FIELD_ENTITY_TYPES = ['companies', 'persons'] as const

/** Entity families that expose `/v2/{entityType}/{id}/notes`. */
export const AFFINITY_NOTE_ENTITY_TYPES = ['companies', 'persons', 'opportunities'] as const

/** Entity families that expose merge endpoints, as the singular path prefix Affinity uses. */
export const AFFINITY_MERGE_PREFIXES = { companies: 'company', persons: 'person' } as const

/** The merge-capable entity families, derived so the two can never drift apart. */
export const AFFINITY_MERGE_ENTITY_TYPES = Object.keys(
  AFFINITY_MERGE_PREFIXES
) as (keyof typeof AFFINITY_MERGE_PREFIXES)[]

/** Affinity's failure envelope. `param` names the rejected input on a validation error. */
interface AffinityErrorBody {
  errors?: { code?: string; message?: string; param?: string }[]
}

/** Query value kinds `buildAffinityUrl` knows how to serialize. */
type QueryValue = string | number | boolean | readonly (string | number)[] | null | undefined

/**
 * Builds a v2 URL, repeating array parameters as `key=a&key=b` — the form
 * Affinity documents for `ids`, `fieldIds`, `fieldTypes`, and `orderBy`.
 * Empty strings and `undefined` are dropped so an untouched optional subblock
 * never reaches the wire.
 */
export function buildAffinityUrl(path: string, query?: Record<string, QueryValue>): string {
  const url = new URL(`${AFFINITY_API_BASE}${path}`)
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === '') continue
    if (Array.isArray(value)) {
      for (const entry of value) url.searchParams.append(key, String(entry))
      continue
    }
    url.searchParams.set(key, String(value))
  }
  return url.toString()
}

/** Bearer headers for every Affinity request. Pass `true` for JSON request bodies. */
export function affinityHeaders(apiKey: string, hasBody = false): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    Accept: 'application/json',
  }
  if (hasBody) headers['Content-Type'] = 'application/json'
  return headers
}

/**
 * Turns a failed response into an `Error` carrying Affinity's own message.
 *
 * Affinity answers every failure with `{errors: [{code, message, param?}]}`;
 * `param` is what names the rejected input on a validation error, so it is kept.
 */
export async function affinityError(response: Response): Promise<Error> {
  const body: AffinityErrorBody | undefined = await response.json().catch(() => undefined)

  const messages = (body?.errors ?? [])
    .map((error) => {
      const message = typeof error?.message === 'string' ? error.message.trim() : ''
      if (!message) return ''
      return error?.param ? `${message} (${error.param})` : message
    })
    .filter(Boolean)

  if (messages.length > 0) return new Error(messages.join('; '))
  return new Error(`Affinity request failed with status ${response.status} ${response.statusText}`)
}

/** Reads a JSON body, reporting a non-JSON payload as itself rather than as a parser stack. */
export async function readAffinityJson<T>(response: Response): Promise<T> {
  const text = await response.text()
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(`Affinity returned a non-JSON response: ${text.slice(0, 200)}`)
  }
}

/**
 * Pulls the opaque `cursor` out of a pagination URL.
 *
 * Affinity paginates with absolute `prevUrl`/`nextUrl` links, but the only
 * input a tool accepts is the cursor itself, so the link is reduced to it.
 */
function extractCursor(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).searchParams.get('cursor')
  } catch {
    return null
  }
}

/** Flattens an Affinity pagination envelope into the cursor outputs every list tool declares. */
function paginationOutput(pagination?: AffinityPagination) {
  return {
    nextCursor: extractCursor(pagination?.nextUrl),
    prevCursor: extractCursor(pagination?.prevUrl),
    totalCount: pagination?.totalCount ?? null,
  }
}

/**
 * Transform for the `{data, pagination}` envelope every collection endpoint returns,
 * naming the rows after the resource so downstream blocks read `companies`, not `data`.
 */
export function transformCollection<K extends string, T = unknown>(key: K) {
  return async (response: Response): Promise<AffinityCollectionResponse<K, T>> => {
    if (!response.ok) throw await affinityError(response)

    const body = await readAffinityJson<{ data?: T[] | null; pagination?: AffinityPagination }>(
      response
    )
    const items = body.data ?? []

    return {
      success: true,
      output: {
        ...({ [key]: items } as Record<K, T[]>),
        count: items.length,
        ...paginationOutput(body.pagination),
      },
    }
  }
}

/** Transform for endpoints that return a single resource object with no envelope. */
export function transformEntity<T extends Record<string, unknown>>() {
  return async (response: Response): Promise<AffinityEntityResponse<T>> => {
    if (!response.ok) throw await affinityError(response)
    return { success: true, output: await readAffinityJson<T>(response) }
  }
}

/** Reads an optional scalar param as a trimmed string, treating a blank field as absent. */
export function optionalParam(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  const trimmed = String(value).trim()
  return trimmed || undefined
}

/** Rejects a blank identifier before spending a round trip on a malformed path. */
export function requireParam(value: unknown, paramName: string): string {
  const trimmed = typeof value === 'string' ? value.trim() : String(value ?? '').trim()
  if (!trimmed) throw new Error(`Affinity "${paramName}" is required`)
  return trimmed
}

/**
 * Reads a required identifier as the number Affinity's request bodies expect.
 *
 * Coercing with a bare `Number()` would send `NaN`, which serializes to `null`
 * and reaches the API as a missing reference rather than a rejected input.
 */
export function requireId(value: unknown, paramName: string): number {
  const parsed = Number(requireParam(value, paramName))
  if (!Number.isInteger(parsed)) {
    throw new Error(`Affinity "${paramName}" must be a numeric ID`)
  }
  return parsed
}

/** Rejects a value outside the set the endpoint family accepts. */
export function requireOneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  paramName: string
): T {
  const candidate = requireParam(value, paramName)
  if (!(allowed as readonly string[]).includes(candidate)) {
    throw new Error(`Affinity "${paramName}" must be one of: ${allowed.join(', ')}`)
  }
  return candidate as T
}

/**
 * Normalizes a list-shaped param into string entries.
 *
 * A subblock hands over a real array, a JSON array string, or — when someone
 * types it by hand — a comma-separated string. All three mean the same list.
 */
export function parseStringList(value: unknown, paramName: string): string[] | undefined {
  if (value === undefined || value === null || value === '') return undefined

  if (Array.isArray(value)) {
    const entries = value.map((entry) => String(entry).trim()).filter(Boolean)
    return entries.length > 0 ? entries : undefined
  }

  if (typeof value !== 'string') {
    throw new Error(`Affinity "${paramName}" must be an array or a JSON array string`)
  }

  const text = value.trim()
  if (!text) return undefined

  if (text.startsWith('[')) {
    const parsed = parseJson<unknown>(text, paramName)
    if (!Array.isArray(parsed)) throw new Error(`Affinity "${paramName}" must be a JSON array`)
    return parseStringList(parsed, paramName)
  }

  const entries = text
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
  return entries.length > 0 ? entries : undefined
}

/** Same normalization as `parseStringList`, rejecting entries Affinity cannot read as an ID. */
export function parseNumberList(value: unknown, paramName: string): number[] | undefined {
  const entries = parseStringList(value, paramName)
  if (!entries) return undefined

  return entries.map((entry) => {
    const parsed = Number(entry)
    if (!Number.isInteger(parsed)) {
      throw new Error(`Affinity "${paramName}" must contain only integer IDs (received "${entry}")`)
    }
    return parsed
  })
}

/** Parses a JSON-typed param, naming the field rather than leaking a parser message. */
function parseJson<T>(value: unknown, paramName: string): T {
  if (typeof value !== 'string') return value as T
  try {
    return JSON.parse(value) as T
  } catch {
    throw new Error(`Affinity "${paramName}" must be valid JSON`)
  }
}

/** Parses an optional JSON object param, treating a blank subblock as "not provided". */
export function parseOptionalJsonObject<T extends Record<string, unknown>>(
  value: unknown,
  paramName: string
): T | undefined {
  if (value === undefined || value === null || value === '') return undefined

  const parsed = parseJson<unknown>(value, paramName)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Affinity "${paramName}" must be a JSON object`)
  }
  return parsed as T
}

/** Parses an optional JSON array param, treating a blank subblock as "not provided". */
export function parseOptionalJsonArray<T>(value: unknown, paramName: string): T[] | undefined {
  if (value === undefined || value === null || value === '') return undefined

  const parsed = parseJson<unknown>(value, paramName)
  if (!Array.isArray(parsed)) throw new Error(`Affinity "${paramName}" must be a JSON array`)
  return parsed as T[]
}

/**
 * Resolves the `ids` / `types` pair the per-entity field reads accept.
 *
 * Affinity documents the two as mutually exclusive, so sending both is rejected
 * here rather than by the API — and by returning the query slice directly, a
 * caller cannot accidentally emit one without the check.
 */
export function selectFieldScope(idsValue: unknown, typesValue: unknown) {
  const ids = parseStringList(idsValue, 'ids')
  const types = parseStringList(typesValue, 'types')
  if (ids && types) {
    throw new Error('Affinity "ids" and "types" are mutually exclusive — supply only one')
  }
  return { ids, types }
}

/** Maps a list of IDs onto the `[{id}]` references Affinity's note and reminder bodies take. */
export function toIdReferences(value: unknown, paramName: string) {
  const ids = parseNumberList(value, paramName)
  return ids?.map((id) => ({ id }))
}

/**
 * Same mapping, but an explicitly empty list survives as `[]`.
 *
 * Note update reads an omitted association as "leave unchanged" and an empty
 * array as "clear all of them", so collapsing `[]` to `undefined` — which is the
 * right call everywhere else — would make the documented clear path unreachable.
 */
export function toIdReferencesPreservingEmpty(value: unknown, paramName: string) {
  if (value === undefined || value === null || value === '') return undefined
  if (Array.isArray(value) && value.length === 0) return []
  if (typeof value === 'string' && value.trim() === '[]') return []
  return toIdReferences(value, paramName) ?? []
}

/**
 * Builds the shared search body used by the company, person, and list-entry
 * search endpoints. Every part is optional; an empty body is equivalent to the
 * matching collection endpoint with default pagination.
 */
export function buildSearchBody(params: {
  filters?: unknown
  sorts?: unknown
  searchTerm?: string
  searchFieldIds?: unknown
}): Record<string, unknown> {
  const body: Record<string, unknown> = {}

  const filters = parseOptionalJsonObject(params.filters, 'filters')
  if (filters) body.filters = filters

  const sorts = parseOptionalJsonArray(params.sorts, 'sorts')
  if (sorts) body.sorts = sorts

  const term = optionalParam(params.searchTerm)
  if (term) {
    const fieldIds = parseStringList(params.searchFieldIds, 'searchFieldIds')
    body.search = fieldIds ? { term, fieldIds } : { term }
  }

  return body
}

/**
 * Transform for the endpoints Affinity answers with `204 No Content`.
 *
 * There is no body to report, so the tool echoes the identifier it acted on —
 * enough for a downstream block to keep working without a follow-up read.
 */
export function transformAcknowledgement<P>(identify: (params: P) => string) {
  return async (response: Response, params?: P): Promise<AffinityAcknowledgementResponse> => {
    if (!response.ok) throw await affinityError(response)
    return { success: true, output: { success: true, id: params ? identify(params) : '' } }
  }
}

/** Colors a dropdown option may carry. */
const AFFINITY_DROPDOWN_COLORS = [
  'white',
  'gray',
  'blue',
  'green',
  'purple',
  'orange',
  'red',
] as const

/** Pipeline meanings a status-dropdown option may carry. */
const AFFINITY_STATUS_CATEGORIES = ['open', 'won', 'lost', 'on-hold'] as const

/** Most field updates Affinity accepts in one batch request. */
export const AFFINITY_MAX_BATCH_FIELD_UPDATES = 100

/** The three kinds of dropdown option, in order of how much each one carries. */
const AFFINITY_DROPDOWN_OPTION_TYPES = ['dropdown', 'ranked-dropdown', 'status-dropdown'] as const

/**
 * Builds the create body for a dropdown option, emitting only the fields its kind accepts.
 *
 * Every create variant is `unevaluatedProperties: false`, so a rank or color sent
 * against a plain `dropdown` is rejected outright — the kind decides the payload,
 * not whichever optional inputs happen to be filled in. The per-kind required
 * fields are checked here so the caller learns about them without a round trip.
 */
export function buildCreateDropdownOptionBody(params: {
  type: unknown
  text: unknown
  rank?: number
  color?: string
  statusCategory?: string
  winRate?: number
}): Record<string, unknown> {
  const type = requireOneOf(params.type, AFFINITY_DROPDOWN_OPTION_TYPES, 'type')
  const body: Record<string, unknown> = { type, text: requireParam(params.text, 'text') }
  if (type === 'dropdown') return body

  if (params.rank === undefined) {
    throw new Error(`Affinity "rank" is required for a ${type} option`)
  }
  body.rank = params.rank
  body.color = requireOneOf(params.color, AFFINITY_DROPDOWN_COLORS, 'color')
  if (type === 'ranked-dropdown') return body

  body.statusCategory = requireOneOf(
    params.statusCategory,
    AFFINITY_STATUS_CATEGORIES,
    'statusCategory'
  )
  if (params.winRate !== undefined) body.winRate = params.winRate
  return body
}

/**
 * Builds the update body for a dropdown option.
 *
 * Update carries no `type` — the option's kind is already fixed — so every field
 * is optional and only what the caller supplied is sent. The update variants are
 * also `unevaluatedProperties: false`, so sending a field the option's kind does
 * not have is rejected by Affinity; passing through only explicit values is what
 * keeps an untouched input from becoming one.
 */
export function buildUpdateDropdownOptionBody(params: {
  text?: string
  rank?: number
  color?: string
  statusCategory?: string
  winRate?: number
}): Record<string, unknown> {
  const body: Record<string, unknown> = {}

  const text = optionalParam(params.text)
  if (text) body.text = text
  if (params.rank !== undefined) body.rank = params.rank
  if (params.color) body.color = requireOneOf(params.color, AFFINITY_DROPDOWN_COLORS, 'color')
  if (params.statusCategory) {
    body.statusCategory = requireOneOf(
      params.statusCategory,
      AFFINITY_STATUS_CATEGORIES,
      'statusCategory'
    )
  }
  if (params.winRate !== undefined) body.winRate = params.winRate

  if (Object.keys(body).length === 0) {
    throw new Error('Affinity Update Dropdown Option needs at least one field to change')
  }
  return body
}

/**
 * Parses a batch field-update array, enforcing the documented 100-item ceiling
 * locally rather than spending a request to be told about it.
 */
export function parseFieldUpdates(value: unknown): Record<string, unknown>[] {
  const updates = parseOptionalJsonArray<Record<string, unknown>>(value, 'updates')
  if (!updates?.length) throw new Error('Affinity "updates" must contain at least one update')
  if (updates.length > AFFINITY_MAX_BATCH_FIELD_UPDATES) {
    throw new Error(
      `Affinity accepts at most ${AFFINITY_MAX_BATCH_FIELD_UPDATES} field updates per request (received ${updates.length})`
    )
  }
  return updates
}

/**
 * Transform for the keyword-search endpoints, which return a relevance-ordered
 * `{data}` list and no pagination envelope.
 */
export function transformKeywordSearch<K extends string>(key: K) {
  return async (response: Response): Promise<AffinityKeywordSearchResponse<K>> => {
    if (!response.ok) throw await affinityError(response)

    const body = await readAffinityJson<{ data?: unknown[] | null }>(response)
    const items = body.data ?? []

    return {
      success: true,
      output: { ...({ [key]: items } as Record<K, unknown[]>), count: items.length },
    }
  }
}

/**
 * Builds the keyword-search body shared by note and file search.
 *
 * The scope is decided by the body: a list of IDs narrows to those records, a
 * company ID narrows to that company, and neither searches the whole account.
 * The two scopes are mutually exclusive, so supplying both is rejected here.
 */
export function buildKeywordSearchBody(
  params: { prompt: unknown; limit?: number; companyId?: string; ids?: unknown },
  idsKey: 'noteIds' | 'fileIds'
): Record<string, unknown> {
  const body: Record<string, unknown> = { prompt: requireParam(params.prompt, 'prompt') }

  const ids = parseNumberList(params.ids, idsKey)
  const companyId = optionalParam(params.companyId)

  if (ids && companyId) {
    throw new Error(`Affinity keyword search takes either "${idsKey}" or "companyId", not both`)
  }
  if (ids) body[idsKey] = ids
  if (companyId) body.companyId = requireId(companyId, 'companyId')
  if (params.limit !== undefined) body.limit = params.limit

  return body
}
