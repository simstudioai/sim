/** Documented base URL for the PitchBook Public API v2 (production and sandbox). */
export const PITCHBOOK_API_BASE = 'https://api.pitchbook.com'

type Unknown = Record<string, unknown>

/**
 * Build the standard PitchBook auth headers. PitchBook authenticates with an
 * `Authorization: PB-Token {API_KEY}` header rather than a bearer token.
 *
 * `X-Currency` is sent only when the caller specifies one; omitting it leaves
 * monetary values in the currency configured on the account's preferences.
 */
export function pitchbookAuthHeaders(apiKey: string, currency?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `PB-Token ${apiKey}`,
    Accept: 'application/json',
  }
  if (currency) headers['X-Currency'] = currency
  return headers
}

/**
 * Extract a human-readable message from a PitchBook error body, which is
 * `{ reason, message }`.
 *
 * An unauthorized response echoes the rejected key back inside `message`
 * ("Active API key {KEY} not found"), so that one case is replaced with a
 * fixed string — the tool result is surfaced in logs and block output, and the
 * upstream text would leak the credential into both.
 */
export async function pitchbookErrorMessage(response: Response, fallback: string): Promise<string> {
  let data: unknown
  try {
    data = await response.json()
  } catch {
    return `${fallback} (HTTP ${response.status})`
  }
  if (!data || typeof data !== 'object') return `${fallback} (HTTP ${response.status})`

  const body = data as Unknown
  const reason = typeof body.reason === 'string' ? body.reason : ''
  if (response.status === 401 || reason === 'UNAUTHORIZED') {
    return 'PitchBook rejected the API key. Check that the key is active and has API access.'
  }

  const message = typeof body.message === 'string' ? body.message : ''
  if (message && reason) return `${message} (${reason})`
  if (message) return message
  if (reason) return reason
  return `${fallback} (HTTP ${response.status})`
}

/** Throw the extracted PitchBook error when a response is not 2xx. */
export async function throwIfNotOk(response: Response, fallback: string): Promise<void> {
  if (response.ok) return
  throw new Error(await pitchbookErrorMessage(response, fallback))
}

/**
 * Normalize an `additionalFilters` value into a plain object.
 *
 * The block parses its JSON before the tool runs, but a direct tool call from a
 * model passes `json` params through as raw strings. Without this,
 * `Object.entries('{"a":1}')` would walk the string's characters and emit
 * index-keyed query params instead of the intended filters.
 */
function coerceFilterObject(value: unknown): Record<string, unknown> | null {
  if (!value) return null
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed === '') return null
    try {
      const parsed = JSON.parse(trimmed)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null
    } catch {
      return null
    }
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return null
}

/**
 * Append the caller's search filters to a query string.
 *
 * Every PitchBook search filter is an ordinary query parameter, and the range
 * filters carry their operator inside the value (`>2023-01-01`, `1^500`), so
 * values pass through untouched. Blank values are dropped so an untouched
 * subblock never narrows a search to nothing.
 */
export function appendFilters(qs: URLSearchParams, filters: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === '') continue
    if (Array.isArray(value)) {
      if (value.length === 0) continue
      qs.set(key, value.map((v) => String(v).trim()).join(','))
      continue
    }
    // Filters routinely carry pasted PitchBook IDs, so trim before encoding —
    // otherwise trailing whitespace becomes %20 and silently matches nothing.
    const text = String(value).trim()
    if (text === '') continue
    qs.set(key, text)
  }
}

/**
 * Build the query string shared by every PitchBook search endpoint: the
 * caller's filters, any extra filters supplied as a JSON object, then
 * pagination. `additionalFilters` is applied first so an explicit subblock
 * always wins over the same key passed loosely.
 */
export function buildSearchQuery(
  filters: Record<string, unknown>,
  options: {
    page?: number
    perPage?: number
    additionalFilters?: Record<string, unknown> | string
  } = {}
): string {
  const qs = new URLSearchParams()
  const extra = coerceFilterObject(options.additionalFilters)
  if (extra) appendFilters(qs, extra)
  appendFilters(qs, filters)
  if (options.page !== undefined && options.page !== null) qs.set('page', String(options.page))
  if (options.perPage !== undefined && options.perPage !== null) {
    qs.set('perPage', String(options.perPage))
  }
  return qs.toString()
}

/** Paging envelope returned by every PitchBook search endpoint. */
export interface PitchbookStats {
  total: number
  perPage: number
  page: number
  lastPage: number
}

/** Normalize the `stats` envelope, which is present on every search response. */
export function mapStats(raw: unknown): PitchbookStats {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Unknown
  return {
    total: typeof s.total === 'number' ? s.total : 0,
    perPage: typeof s.perPage === 'number' ? s.perPage : 0,
    page: typeof s.page === 'number' ? s.page : 0,
    lastPage: typeof s.lastPage === 'number' ? s.lastPage : 0,
  }
}
