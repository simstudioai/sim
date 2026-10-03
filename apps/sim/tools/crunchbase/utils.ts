import type {
  CrunchbaseEntityIdentifier,
  CrunchbaseEntityParams,
  CrunchbaseEntityResponse,
  CrunchbaseOrder,
  CrunchbasePredicate,
  CrunchbaseProperties,
  CrunchbaseSearchEntity,
  CrunchbaseSearchParams,
  CrunchbaseSearchResponse,
} from '@/tools/crunchbase/types'

/** Crunchbase API v4 origin, as declared by every published OpenAPI document. */
export const CRUNCHBASE_API_ROOT = 'https://api.crunchbase.com/v4'

/** Entity, search, autocomplete, and deleted-entity endpoints hang off `/data`. */
export const CRUNCHBASE_API_BASE = `${CRUNCHBASE_API_ROOT}/data`

/**
 * Every collection exposed by `/data/searches/{collection}` and
 * `/data/entities/{collection}/{entity_id}`.
 *
 * Both endpoint families cover the same 43 collections. Which of them answer
 * depends on the license: Firmographic, Core Financials, Advanced Financials,
 * Insights Only, and Predictions & Insights each publish a subset.
 */
export const CRUNCHBASE_COLLECTIONS = [
  'acquisition_predictions',
  'acquisitions',
  'addresses',
  'awards',
  'categories',
  'category_groups',
  'closure_predictions',
  'current_valuation_estimates',
  'degrees',
  'diversity_spotlights',
  'event_appearances',
  'events',
  'funding_predictions',
  'funding_rounds',
  'funds',
  'growth_insights',
  'growth_predictions',
  'investments',
  'investor_insights',
  'investor_matches',
  'ipo_predictions',
  'ipos',
  'jobs',
  'key_employee_changes',
  'layoff_predictions',
  'layoffs',
  'legal_proceedings',
  'locations',
  'market_insight_reasons',
  'market_insights',
  'micro_categories',
  'org_similarities',
  'organizations',
  'ownerships',
  'partnership_announcements',
  'people',
  'press_references',
  'principals',
  'product_launches',
  'product_similarities',
  'products',
  'remain_private_predictions',
  'research_insights',
] as const

/**
 * Collections that publish a single-card endpoint.
 *
 * `/data/entities/{collection}/{entity_id}/cards/{card_id}` is the only way past
 * the 100-item cap an inline `card_ids` request is subject to.
 */
export const CRUNCHBASE_CARD_COLLECTIONS = [
  'acquisitions',
  'addresses',
  'categories',
  'category_groups',
  'degrees',
  'event_appearances',
  'events',
  'funding_rounds',
  'funds',
  'investments',
  'ipos',
  'jobs',
  'market_insights',
  'micro_categories',
  'organizations',
  'ownerships',
  'people',
] as const

/**
 * Collections the deleted-entity feed covers.
 *
 * The union across the published packages, not the narrowest one — Firmographic
 * publishes nine and Advanced Financials adds acquisitions, funding_rounds,
 * funds, investments, and press_references. A tier-narrow allowlist rejects a
 * request a richer license answers before it ever reaches Crunchbase.
 */
export const CRUNCHBASE_DELETED_COLLECTIONS = [
  'acquisitions',
  'categories',
  'event_appearances',
  'events',
  'funding_rounds',
  'funds',
  'investments',
  'ipos',
  'jobs',
  'locations',
  'organizations',
  'ownerships',
  'people',
  'press_references',
] as const

/**
 * Collections the fields-metadata export covers.
 *
 * Predictions & Insights publishes all 43, so the union is every collection.
 */
export const CRUNCHBASE_METADATA_COLLECTIONS = CRUNCHBASE_COLLECTIONS

/**
 * Collections the autocomplete endpoint can be constrained to.
 *
 * Predictions & Insights publishes all 43, so the union is every collection.
 */
export const CRUNCHBASE_AUTOCOMPLETE_COLLECTIONS = CRUNCHBASE_COLLECTIONS

/** `limit` bounds the Search API documents (default 100). */
export const SEARCH_LIMIT_MIN = 1
export const SEARCH_LIMIT_MAX = 1000
export const SEARCH_LIMIT_DEFAULT = 100

/** `limit` bounds the Autocomplete API documents (default 10). */
export const AUTOCOMPLETE_LIMIT_MAX = 25

/**
 * `limit` bound the deleted-entity feed documents (default 10).
 *
 * Far lower than Search's 1000, and the block shares one Limit subblock across
 * both — a value carried over from a search would otherwise be rejected.
 */
export const DELETED_LIMIT_MAX = 25

/** Crunchbase allows at most 25 predicates, each carrying at most 200 values. */
export const MAX_PREDICATES = 25
export const MAX_PREDICATE_VALUES = 200

/**
 * Default `field_ids` for the collections this integration exposes directly.
 *
 * `field_ids` is required on every Search request and narrows a lookup to the
 * identifier alone when omitted, so each of those tools falls back to a readable
 * column set. Every id below is taken from the published field enum of the
 * narrowest package that exposes its collection, so they resolve on the widest
 * range of licenses.
 */
export const DEFAULT_ORGANIZATION_FIELD_IDS = [
  'identifier',
  'name',
  'short_description',
  'website_url',
  'linkedin',
  'location_identifiers',
  'categories',
  'founded_on',
  'num_employees_enum',
  'operating_status',
  'rank_org',
  'permalink',
] as const

export const DEFAULT_PERSON_FIELD_IDS = [
  'identifier',
  'name',
  'first_name',
  'last_name',
  'primary_job_title',
  'primary_organization',
  'short_description',
  'location_identifiers',
  'linkedin',
  'rank_person',
  'permalink',
] as const

export const DEFAULT_FUNDING_ROUND_FIELD_IDS = [
  'identifier',
  'announced_on',
  'investment_type',
  'investment_stage',
  'money_raised',
  'funded_organization_identifier',
  'investor_identifiers',
  'lead_investor_identifiers',
  'num_investors',
  'short_description',
  'permalink',
] as const

export const DEFAULT_ACQUISITION_FIELD_IDS = [
  'identifier',
  'acquiree_identifier',
  'acquirer_identifier',
  'announced_on',
  'completed_on',
  'price',
  'acquisition_type',
  'status',
  'terms',
  'short_description',
  'permalink',
] as const

/** Authenticates with the documented API-key header rather than a query param. */
export function crunchbaseHeaders(apiKey: string): Record<string, string> {
  return {
    'X-cb-user-key': apiKey,
    Accept: 'application/json',
  }
}

/** Adds the body content type the Search API's POST requests carry. */
export function crunchbaseJsonHeaders(apiKey: string): Record<string, string> {
  return { ...crunchbaseHeaders(apiKey), 'Content-Type': 'application/json' }
}

/**
 * Normalizes a JSON-array param that may arrive already parsed.
 *
 * A block-to-block reference hands over a real array; a text field and an LLM
 * tool call both hand over a JSON string. Throwing here is deliberate — the
 * request builder is the one place the executor surfaces the failure cleanly
 * instead of silently sending a string where an array belongs.
 */
export function parseArrayParam<T>(value: unknown, paramName: string): T[] | undefined {
  if (value === undefined || value === null) return undefined

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed === '') return undefined

    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      throw new Error(`Crunchbase "${paramName}" must be a JSON array`)
    }

    if (!Array.isArray(parsed)) {
      throw new Error(`Crunchbase "${paramName}" must be a JSON array`)
    }
    return parsed as T[]
  }

  if (Array.isArray(value)) return value as T[]

  throw new Error(`Crunchbase "${paramName}" must be a JSON array`)
}

/**
 * Normalizes a list of plain ids, which a bare comma-separated string satisfies.
 *
 * Only for flat id lists (`field_ids`, `card_ids`, `collection_ids`) — typing
 * `identifier, name` by hand is natural there, whereas a predicate or sort
 * clause is an object and a comma split would quietly produce nonsense.
 */
export function parseIdListParam(value: unknown, paramName: string): string[] | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed === '') return undefined
    if (!trimmed.startsWith('[')) {
      return trimmed
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean)
    }
  }

  const parsed = parseArrayParam<unknown>(value, paramName)
  return parsed?.map((entry) => String(entry))
}

/**
 * `limit` bound for a single card page.
 *
 * A card returns at most 100 items, and the Limit subblock is shared with Search
 * (max 1000), so a value carried over from a search would otherwise go out on
 * the wire and be rejected.
 */
export const CARD_LIMIT_MAX = 100

/**
 * Rejects the cursor pair Crunchbase documents as mutually exclusive.
 *
 * `after_id` "may not be provided simultaneously with before_id" on every paged
 * endpoint, and the block shares one After ID / Before ID pair across searches,
 * card pages, and the deleted feed — so a leftover value really can arrive here.
 */
export function assertSingleCursor(afterId?: string, beforeId?: string): void {
  if (afterId && beforeId) {
    throw new Error('Crunchbase accepts either "afterId" or "beforeId", not both')
  }
}

/** Coerces a numeric param and clamps it into the endpoint's documented range. */
export function clampLimit(value: unknown, max: number, fallback?: number): number | undefined {
  if (value === undefined || value === null || value === '') return fallback
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(Math.trunc(parsed), SEARCH_LIMIT_MIN), max)
}

/**
 * Validates the predicate list before it leaves Sim.
 *
 * A malformed predicate comes back as a generic 400, so naming the offending
 * entry here is the difference between a fixable message and a dead end.
 */
export function normalizePredicates(value: unknown): CrunchbasePredicate[] {
  const predicates = parseArrayParam<Record<string, unknown>>(value, 'query') ?? []

  if (predicates.length > MAX_PREDICATES) {
    throw new Error(`Crunchbase accepts at most ${MAX_PREDICATES} query predicates`)
  }

  return predicates.map((predicate, index) => {
    if (typeof predicate !== 'object' || predicate === null) {
      throw new Error(`Crunchbase query predicate ${index + 1} must be an object`)
    }
    const fieldId = predicate.field_id
    const operatorId = predicate.operator_id
    if (typeof fieldId !== 'string' || fieldId === '') {
      throw new Error(`Crunchbase query predicate ${index + 1} is missing "field_id"`)
    }
    if (typeof operatorId !== 'string' || operatorId === '') {
      throw new Error(`Crunchbase query predicate ${index + 1} is missing "operator_id"`)
    }

    const values = predicate.values
    if (Array.isArray(values) && values.length > MAX_PREDICATE_VALUES) {
      throw new Error(
        `Crunchbase query predicate ${index + 1} carries ${values.length} values; at most ${MAX_PREDICATE_VALUES} are allowed`
      )
    }

    return {
      type: 'predicate',
      field_id: fieldId,
      operator_id: operatorId,
      ...(Array.isArray(values) ? { values: values as Array<string | number | boolean> } : {}),
    }
  })
}

/** Validates the sort clauses, which share the predicates' failure mode. */
export function normalizeOrder(value: unknown): CrunchbaseOrder[] | undefined {
  const clauses = parseArrayParam<Record<string, unknown>>(value, 'order')
  if (!clauses?.length) return undefined

  return clauses.map((clause, index) => {
    if (typeof clause !== 'object' || clause === null) {
      throw new Error(`Crunchbase order clause ${index + 1} must be an object`)
    }
    const fieldId = clause.field_id
    if (typeof fieldId !== 'string' || fieldId === '') {
      throw new Error(`Crunchbase order clause ${index + 1} is missing "field_id"`)
    }
    const sort = clause.sort === 'desc' ? 'desc' : 'asc'
    const nulls = clause.nulls === 'first' || clause.nulls === 'last' ? clause.nulls : undefined
    return { field_id: fieldId, sort, ...(nulls ? { nulls } : {}) }
  })
}

/**
 * Appends a repeated-id query param.
 *
 * The spec declares `field_ids` and `card_ids` as `style: form, explode: false`,
 * so the wire form is one comma-separated value, not repeated keys.
 */
export function appendCsvParam(
  search: URLSearchParams,
  key: string,
  values: readonly string[] | undefined
): void {
  if (!values?.length) return
  search.set(key, values.join(','))
}

/**
 * Turns a failed Crunchbase response into a readable error.
 *
 * Errors come back as a JSON array — `[{"status":401,"code":"LA401","message":
 * "Unauthorized user_key"}]` — so the usual `data.message` lookup finds nothing
 * and the failure would otherwise report only its HTTP status.
 */
export async function crunchbaseError(response: Response): Promise<Error> {
  const raw = await response.text()
  let detail = raw.trim()

  try {
    const parsed = JSON.parse(raw)
    const entries: unknown[] = Array.isArray(parsed) ? parsed : [parsed]
    const messages = entries
      .map((entry) => {
        if (typeof entry !== 'object' || entry === null) return ''
        const message = (entry as { message?: unknown }).message
        return typeof message === 'string' ? message.trim() : ''
      })
      .filter(Boolean)
    if (messages.length > 0) detail = messages.join('; ')
  } catch {
    /* Not JSON — fall back to the raw body, which is usually a gateway page. */
  }

  return new Error(
    `Crunchbase API error: ${response.status} ${response.statusText}${detail ? ` - ${detail}` : ''}`
  )
}

/** Reads a JSON body, tolerating an empty one rather than throwing on it. */
export async function readJson<T>(response: Response): Promise<T> {
  const raw = await response.text()
  if (raw.trim() === '') return {} as T
  return JSON.parse(raw) as T
}

function asIdentifier(value: unknown): CrunchbaseEntityIdentifier | null {
  if (typeof value !== 'object' || value === null) return null
  const identifier = value as Partial<CrunchbaseEntityIdentifier>
  return typeof identifier.uuid === 'string' ? (identifier as CrunchbaseEntityIdentifier) : null
}

/**
 * Lifts the identity of a looked-up entity out of its dynamic property bag.
 *
 * Which keys are present depends entirely on the requested `field_ids`, so each
 * value degrades to null rather than throwing.
 */
export function extractIdentity(properties: CrunchbaseProperties | undefined): {
  uuid: string | null
  name: string | null
  permalink: string | null
} {
  const identifier = asIdentifier(properties?.identifier)
  const name = typeof properties?.name === 'string' ? properties.name : null
  const permalink = typeof properties?.permalink === 'string' ? properties.permalink : null

  return {
    uuid: identifier?.uuid ?? null,
    name: name ?? identifier?.value ?? null,
    permalink: permalink ?? identifier?.permalink ?? null,
  }
}

/**
 * Builds a Search API body.
 *
 * Shared at runtime only — each tool still spells out its own `params` and
 * `outputs` literally, because the docs generator reads tool sources statically
 * and cannot follow a spread from this module.
 */
export function buildSearchBody(
  params: CrunchbaseSearchParams,
  defaultFieldIds?: readonly string[]
): Record<string, unknown> {
  const fieldIds = parseIdListParam(params.fieldIds, 'fieldIds')
  const order = normalizeOrder(params.order)
  const limit = clampLimit(params.limit, SEARCH_LIMIT_MAX, SEARCH_LIMIT_DEFAULT)

  assertSingleCursor(params.afterId, params.beforeId)

  const resolvedFieldIds = fieldIds?.length ? fieldIds : [...(defaultFieldIds ?? [])]
  if (resolvedFieldIds.length === 0) {
    throw new Error(
      'Crunchbase "fieldIds" is required — the valid ids differ per collection, so there is no safe default'
    )
  }

  return {
    field_ids: resolvedFieldIds,
    query: normalizePredicates(params.query),
    ...(order ? { order } : {}),
    ...(limit !== undefined ? { limit } : {}),
    ...(params.afterId ? { after_id: params.afterId } : {}),
    ...(params.beforeId ? { before_id: params.beforeId } : {}),
  }
}

/** Projects a Search API response, carrying the cursor for the next page. */
export async function transformSearchResponse(
  response: Response
): Promise<CrunchbaseSearchResponse> {
  if (!response.ok) throw await crunchbaseError(response)

  const data = await readJson<{ count?: number; entities?: CrunchbaseSearchEntity[] }>(response)
  const entities = Array.isArray(data.entities) ? data.entities : []
  const last = entities[entities.length - 1]

  return {
    success: true,
    output: {
      count: typeof data.count === 'number' ? data.count : null,
      entities,
      nextAfterId: last?.uuid ?? null,
    },
  }
}

/** Builds an Entity Lookup URL from the shared `field_ids` / `card_ids` pair. */
export function buildEntityUrl(
  collection: string,
  params: CrunchbaseEntityParams,
  defaultFieldIds?: readonly string[]
): string {
  const entityId = params.entityId?.trim()
  if (!entityId) throw new Error('Crunchbase "entityId" (uuid or permalink) is required')

  const fieldIds = parseIdListParam(params.fieldIds, 'fieldIds')
  const cardIds = parseIdListParam(params.cardIds, 'cardIds')

  /* With no field_ids the API answers with its own default projection, which is
     the honest fallback for a collection this integration has no verified list
     for. */
  const search = new URLSearchParams()
  appendCsvParam(search, 'field_ids', fieldIds?.length ? fieldIds : defaultFieldIds)
  appendCsvParam(search, 'card_ids', cardIds)

  const qs = search.toString()
  return `${CRUNCHBASE_API_BASE}/entities/${collection}/${encodeURIComponent(entityId)}${qs ? `?${qs}` : ''}`
}

/** Projects an Entity Lookup response into its identity, fields, and cards. */
export async function transformEntityResponse(
  response: Response
): Promise<CrunchbaseEntityResponse> {
  if (!response.ok) throw await crunchbaseError(response)

  const data = await readJson<{
    properties?: CrunchbaseProperties
    cards?: Record<string, unknown>
  }>(response)
  const properties = data.properties ?? {}

  return {
    success: true,
    output: {
      ...extractIdentity(properties),
      properties,
      cards: data.cards ?? null,
    },
  }
}

/** Rejects a collection the API does not publish before spending a round trip. */
export function assertCollection(
  value: unknown,
  allowed: readonly string[],
  paramName: string
): string {
  const collection = typeof value === 'string' ? value.trim() : ''
  if (!allowed.includes(collection)) {
    throw new Error(
      `Crunchbase "${paramName}" must be one of: ${allowed.join(', ')} (received "${String(value ?? '')}")`
    )
  }
  return collection
}

/** Rejects any collection id the endpoint does not publish. */
export function assertCollections(
  values: readonly string[] | undefined,
  allowed: readonly string[],
  paramName: string
): string[] | undefined {
  if (!values?.length) return undefined
  const unknown = values.filter((value) => !allowed.includes(value))
  if (unknown.length > 0) {
    throw new Error(
      `Crunchbase "${paramName}" contains unsupported collection(s): ${unknown.join(', ')}. Allowed: ${allowed.join(', ')}`
    )
  }
  return [...values]
}
