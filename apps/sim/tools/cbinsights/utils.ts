import { getErrorMessage } from '@sim/utils/errors'
import { LRUCache } from 'lru-cache'
import {
  DEFAULT_MAX_ERROR_BODY_BYTES,
  readResponseTextWithLimit,
} from '@/lib/core/utils/stream-limits'
import { MAX_INLINE_MATERIALIZATION_BYTES } from '@/lib/execution/payloads/limits'
import type {
  CbInsightsAuthParams,
  CbInsightsPageInfo,
  CbInsightsRecord,
} from '@/tools/cbinsights/types'
import type { ToolResponse } from '@/tools/types'

/** CB Insights API v2 origin, as declared by the published Swagger document. */
export const CBINSIGHTS_API_BASE = 'https://api.cbinsights.com'

const REQUEST_TIMEOUT_MS = 120_000

/**
 * A Scouting Report is generated on demand and the docs warn it "may take
 * several minutes", so it gets its own ceiling rather than the shared one.
 */
export const SCOUTING_REPORT_TIMEOUT_MS = 600_000

/**
 * The bounds the list endpoints document.
 *
 * `orgIds` is "1 - 100 Org IDs" and `limit` is "in the range [1, 100]". Two
 * endpoints state neither — `/v2/businessrelationships` for `orgIds` and
 * `/v2/firmographics` for `limit` — and are held to the same ceiling anyway, so
 * a caller sees one rule rather than a per-operation exception.
 */
export const MAX_ORG_IDS = 100
export const LIMIT_MIN = 1
export const LIMIT_MAX = 100

const TOKEN_CACHE_TTL_MS = 5 * 60 * 1000

/**
 * Ceiling on distinct credential pairs held at once.
 *
 * The cache is process-wide, so on a long-lived worker serving many CB Insights
 * accounts it would otherwise grow with the cumulative number of accounts seen.
 * Exceeding it evicts inside the TTL, which costs one extra token exchange —
 * never a wrong answer.
 */
const TOKEN_CACHE_MAX_ENTRIES = 128

/**
 * Cached bearer tokens, keyed by a digest of the credentials rather than the
 * credentials themselves.
 *
 * The token's lifetime is not documented, so this TTL is deliberately short and
 * is not load-bearing: {@link cbInsightsRequest} clears the entry and
 * re-authorizes once on a 401, which is what actually makes expiry correct.
 */
const tokenCache = new LRUCache<string, string>({
  max: TOKEN_CACHE_MAX_ENTRIES,
  ttl: TOKEN_CACHE_TTL_MS,
})

async function credentialDigest(clientId: string, clientSecret: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${clientId}:${clientSecret}`)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Reads a bounded body, tolerating an empty one rather than throwing on it.
 *
 * A Scouting Report or a wide firmographics page can be large, so the cap is
 * the executor's own inline-materialization limit rather than an ad-hoc number.
 */
async function readJsonBody<T>(response: Response): Promise<T> {
  const raw = await readResponseTextWithLimit(response, {
    maxBytes: MAX_INLINE_MATERIALIZATION_BYTES,
    label: 'CB Insights response',
  })
  if (raw.trim() === '') return {} as T
  return JSON.parse(raw) as T
}

/**
 * Turns a failed CB Insights response into a readable error.
 *
 * Failures carry `{"error": "..."}`; anything else (a gateway page, an empty
 * body) falls back to the status so the message is never just "request failed".
 */
async function cbInsightsError(response: Response, action: string): Promise<Error> {
  let detail = ''
  try {
    const raw = await readResponseTextWithLimit(response, {
      maxBytes: DEFAULT_MAX_ERROR_BODY_BYTES,
      label: 'CB Insights error response',
    })
    const trimmed = raw.trim()
    if (trimmed !== '') {
      try {
        const parsed: unknown = JSON.parse(trimmed)
        const message =
          typeof parsed === 'object' && parsed !== null
            ? (parsed as { error?: unknown }).error
            : undefined
        detail = typeof message === 'string' && message.trim() !== '' ? message.trim() : trimmed
      } catch {
        detail = trimmed
      }
    }
  } catch {
    /* Body unreadable — the status alone still names the failure. */
  }

  return new Error(
    `CB Insights ${action} failed: ${response.status} ${response.statusText}${detail ? ` - ${detail}` : ''}`
  )
}

/** Exchanges the client credentials for a bearer token. */
async function authorize(
  clientId: string,
  clientSecret: string,
  signal?: AbortSignal
): Promise<string> {
  const response = await fetch(`${CBINSIGHTS_API_BASE}/v2/authorize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ clientId, clientSecret }),
    signal,
  })

  if (!response.ok) throw await cbInsightsError(response, 'authorization')

  const data = await readJsonBody<{ token?: unknown }>(response)
  if (typeof data.token !== 'string' || data.token === '') {
    throw new Error('CB Insights authorization returned no token')
  }
  return data.token
}

async function getToken(
  params: CbInsightsAuthParams,
  signal: AbortSignal | undefined,
  forceRefresh: boolean
): Promise<string> {
  const clientId = params.clientId?.trim()
  const clientSecret = params.clientSecret?.trim()
  if (!clientId) throw new Error('CB Insights "clientId" is required')
  if (!clientSecret) throw new Error('CB Insights "clientSecret" is required')

  const key = await credentialDigest(clientId, clientSecret)
  if (forceRefresh) tokenCache.delete(key)

  const cached = tokenCache.get(key)
  if (cached !== undefined) return cached

  const token = await authorize(clientId, clientSecret, signal)
  tokenCache.set(key, token)
  return token
}

/** Clears every cached token. Exported for tests. */
export function resetCbInsightsTokenCache(): void {
  tokenCache.clear()
}

/** Current number of cached tokens. Exported for tests. */
export function cbInsightsTokenCacheSize(): number {
  return tokenCache.size
}

interface CbInsightsRequestSpec {
  /** Path below the API origin, e.g. `/v2/firmographics`. */
  path: string
  /** JSON body. Every documented v2 endpoint is a POST. */
  body?: Record<string, unknown>
  /** Overrides the shared deadline for a deliberately long endpoint. */
  timeoutMs?: number
}

/**
 * Runs one authorized CB Insights call.
 *
 * Shared at runtime only — each tool still spells out its own `params` and
 * `outputs` literally, because the docs generator parses tool sources
 * statically and cannot follow a spread from this module.
 *
 * A 401 is retried exactly once against a freshly minted token: the token's
 * documented lifetime is unknown, so expiry has to be discovered rather than
 * predicted. This is not a general retry loop — any other status, and a second
 * 401, fails.
 */
export async function cbInsightsRequest<T>(
  params: CbInsightsAuthParams,
  spec: CbInsightsRequestSpec,
  project: (data: T) => Record<string, unknown>,
  signal?: AbortSignal
): Promise<ToolResponse> {
  const timeout = AbortSignal.timeout(spec.timeoutMs ?? REQUEST_TIMEOUT_MS)
  const effectiveSignal = signal ? AbortSignal.any([signal, timeout]) : timeout

  const send = async (token: string) =>
    fetch(`${CBINSIGHTS_API_BASE}${spec.path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(spec.body ?? {}),
      signal: effectiveSignal,
    })

  try {
    let response = await send(await getToken(params, effectiveSignal, false))

    if (response.status === 401) {
      response = await send(await getToken(params, effectiveSignal, true))
    }

    if (!response.ok) throw await cbInsightsError(response, `request to ${spec.path}`)

    const data = await readJsonBody<T>(response)
    return { success: true, output: project(data) }
  } catch (error) {
    if (timeout.aborted && !signal?.aborted) {
      throw new Error(`CB Insights request to ${spec.path} timed out`)
    }
    throw new Error(getErrorMessage(error, `CB Insights request to ${spec.path} failed`))
  }
}

/**
 * Accepts only a plain run of decimal digits.
 *
 * `Number` is far more permissive than an ID field should be: it reads `0x10`
 * as 16 and `1e2` as 100, so a pasted value in either notation would resolve to
 * a real but unintended organization and the request would spend credits on it.
 */
const DECIMAL_ID = /^\d+$/

/** Coerces one entry to a positive integer ID, or returns null if it is not one. */
function toOrgId(value: unknown): number | null {
  /* Safe, not merely integral: JSON parsing has already rounded anything past
     the precision limit, so accepting it would target a different ID than the
     one supplied. The string branch below applies the same bound. */
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? value : null
  }
  if (typeof value !== 'string') return null

  const trimmed = value.trim()
  if (!DECIMAL_ID.test(trimmed)) return null

  const parsed = Number(trimmed)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

/** Validates the organization ID a path-scoped endpoint interpolates. */
export function requireOrgId(value: unknown): number {
  const parsed = toOrgId(value)
  if (parsed === null) {
    throw new Error(
      `CB Insights "orgId" must be a positive integer (received "${String(value ?? '')}")`
    )
  }
  return parsed
}

/**
 * Normalizes the 1-100 organization IDs a list endpoint takes.
 *
 * A block-to-block reference hands over a real array; a text field and an LLM
 * tool call both hand over a JSON string, so both are accepted. A bare
 * comma-separated list is the natural way to type IDs by hand.
 */
export function requireOrgIds(value: unknown): number[] {
  let raw: unknown[] = []

  if (Array.isArray(value)) {
    raw = value
  } else if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed === '') throw new Error('CB Insights "orgIds" is required')
    if (trimmed.startsWith('[')) {
      let parsed: unknown
      try {
        parsed = JSON.parse(trimmed)
      } catch {
        throw new Error('CB Insights "orgIds" must be a JSON array of integers')
      }
      if (!Array.isArray(parsed)) {
        throw new Error('CB Insights "orgIds" must be a JSON array of integers')
      }
      raw = parsed
    } else {
      raw = splitCommaList(trimmed)
    }
  } else if (value !== undefined && value !== null) {
    raw = [value]
  }

  const orgIds = toPositiveIntegers(raw, 'orgIds')

  if (orgIds.length === 0) {
    throw new Error('CB Insights "orgIds" must contain at least one positive integer')
  }
  if (orgIds.length > MAX_ORG_IDS) {
    throw new Error(`CB Insights accepts at most ${MAX_ORG_IDS} organization IDs per request`)
  }
  return orgIds
}

/**
 * Converts every entry to a positive integer, rejecting the whole list if any
 * entry is not one.
 *
 * Dropping the bad entries instead would run the request against a silently
 * narrower set — a typo in an ID list would spend credits on the wrong
 * organizations, or quietly widen a filtered search, and still report success.
 */
function toPositiveIntegers(entries: readonly unknown[], paramName: string): number[] {
  const invalid: string[] = []
  const ids: number[] = []

  for (const entry of entries) {
    const parsed = toOrgId(entry)
    if (parsed === null) {
      invalid.push(typeof entry === 'string' ? entry.trim() : String(entry))
      continue
    }
    ids.push(parsed)
  }

  if (invalid.length > 0) {
    throw new Error(
      `CB Insights "${paramName}" must contain only positive integers (invalid: ${invalid.join(', ')})`
    )
  }
  return ids
}

/**
 * Coerces a page size and clamps it into the documented [1, 100] range.
 *
 * Clamping an out-of-range number is what the bound is for, but a value that is
 * not a number at all is rejected rather than dropped: silently falling back to
 * the endpoint default would return a different page than the caller asked for
 * and still bill for it. Same reasoning as {@link parseNumberParam}, which does
 * the coercion.
 */
export function clampLimit(value: unknown): number | undefined {
  const parsed = parseNumberParam(value, 'limit')
  if (parsed === undefined) return undefined
  return Math.min(Math.max(Math.trunc(parsed), LIMIT_MIN), LIMIT_MAX)
}

/**
 * Splits a hand-typed comma list, discarding empty segments.
 *
 * An empty segment is a separator artifact — a trailing comma, or a double one —
 * and carries no value, so dropping it cannot change *which* records are
 * requested. That is the opposite of dropping a mistyped entry like `notanid`,
 * which silently discards an ID the caller meant to include. Both the required
 * and the optional paths route through here so the same typing produces the same
 * result on every operation.
 */
function splitCommaList(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
}

/**
 * Parses a JSON-array param that may arrive already parsed, tolerating a bare
 * comma-separated list for the flat ID filters.
 */
export function parseListParam(value: unknown, paramName: string): unknown[] | undefined {
  if (value === undefined || value === null) return undefined
  if (Array.isArray(value)) return value.length > 0 ? value : undefined

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed === '') return undefined
    if (!trimmed.startsWith('[')) {
      const entries = splitCommaList(trimmed)
      return entries.length > 0 ? entries : undefined
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      throw new Error(`CB Insights "${paramName}" must be a JSON array`)
    }
    if (!Array.isArray(parsed)) {
      throw new Error(`CB Insights "${paramName}" must be a JSON array`)
    }
    return parsed.length > 0 ? parsed : undefined
  }

  return [value]
}

/**
 * Parses an optional list of IDs, rejecting any entry that is not a positive
 * integer.
 *
 * An unset filter is fine and returns undefined; a filter the caller *did* set
 * but mistyped is not, because dropping it would silently widen the search
 * rather than narrow it — and the wider search still spends credits.
 */
export function parseIdListParam(value: unknown, paramName: string): number[] | undefined {
  const entries = parseListParam(value, paramName)
  if (!entries) return undefined
  return toPositiveIntegers(entries, paramName)
}

/**
 * Parses a list of free-text values, rejecting an entry that is not text.
 *
 * Stringifying whatever arrives would turn an object handed over by a
 * block-to-block reference into the literal `[object Object]` and search for
 * that — a filter the caller set, quietly replaced by one that matches nothing,
 * reported as success. An empty entry is still dropped, for the same reason
 * {@link splitCommaList} drops one: it carries no filtering meaning.
 */
export function parseStringListParam(value: unknown, paramName: string): string[] | undefined {
  const entries = parseListParam(value, paramName)
  if (!entries) return undefined

  const values: string[] = []
  const invalid: string[] = []
  for (const entry of entries) {
    if (typeof entry !== 'string' && typeof entry !== 'number') {
      invalid.push(String(entry))
      continue
    }
    const text = String(entry).trim()
    if (text !== '') values.push(text)
  }

  if (invalid.length > 0) {
    throw new Error(
      `CB Insights "${paramName}" must contain only text values (invalid: ${invalid.join(', ')})`
    )
  }
  return values.length > 0 ? values : undefined
}

/**
 * Coerces an optional numeric filter, rejecting a value that is not a number.
 *
 * Dropping it would widen the search rather than narrow it — a mistyped headcount
 * or valuation bound would silently disappear and the broader query would still
 * spend credits. Same reasoning as the ID lists.
 */
export function parseNumberParam(value: unknown, paramName: string): number | undefined {
  if (value === undefined || value === null) return undefined

  let parsed: number
  if (typeof value === 'number') {
    parsed = value
  } else {
    /* A whitespace-only field is an empty one, not a malformed number — without
       the trim, `Number('  ')` is 0 and the filter silently becomes a real
       bound of zero. */
    const trimmed = String(value).trim()
    if (trimmed === '') return undefined
    parsed = Number(trimmed)
  }

  if (!Number.isFinite(parsed)) {
    throw new Error(`CB Insights "${paramName}" must be a number (received "${String(value)}")`)
  }
  return parsed
}

/** Coerces an optional integer filter, rejecting a value that is not a number. */
export function parseIntegerParam(value: unknown, paramName: string): number | undefined {
  const parsed = parseNumberParam(value, paramName)
  return parsed === undefined ? undefined : Math.trunc(parsed)
}

/**
 * Coerces an optional boolean filter, accepting the string form a dropdown emits
 * and rejecting anything else.
 *
 * Same reasoning as {@link parseNumberParam}: only an *unset* value may mean "no
 * filter". Returning undefined for `"yes"` or `1` would drop a restriction the
 * caller asked for and widen the search — and the wider search still spends
 * credits.
 */
export function parseBooleanParam(value: unknown, paramName: string): boolean | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'boolean') return value

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === '') return undefined
    if (normalized === 'true') return true
    if (normalized === 'false') return false
  }

  throw new Error(`CB Insights "${paramName}" must be true or false (received "${String(value)}")`)
}

/** Drops keys the caller left unset so an optional filter is never sent empty. */
export function compactBody(body: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(body)) {
    if (value === undefined || value === null || value === '') continue
    if (Array.isArray(value) && value.length === 0) continue
    result[key] = value
  }
  return result
}

/** Reads the paging envelope the list endpoints share. */
export function pageInfo(data: {
  nextPageToken?: unknown
  totalHits?: unknown
  totalHitsRelation?: unknown
}): CbInsightsPageInfo {
  return {
    nextPageToken: typeof data.nextPageToken === 'string' ? data.nextPageToken : null,
    totalHits: typeof data.totalHits === 'number' ? data.totalHits : null,
    totalHitsRelation: typeof data.totalHitsRelation === 'string' ? data.totalHitsRelation : null,
  }
}

/** Narrows an optional array field to a list, never null. */
export function asArray(value: unknown): CbInsightsRecord[] {
  return Array.isArray(value) ? (value as CbInsightsRecord[]) : []
}

/** Narrows an optional string array. */
export function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : []
}

/** Narrows an optional object field. */
export function asRecord(value: unknown): CbInsightsRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as CbInsightsRecord)
    : null
}

/** Narrows an optional string field. */
export function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

/** Narrows an optional number field. */
export function asNumber(value: unknown): number | null {
  return typeof value === 'number' ? value : null
}
