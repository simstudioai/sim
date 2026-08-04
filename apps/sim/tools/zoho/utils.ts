import { truncate } from '@sim/utils/string'

/**
 * Zoho data centers Sim supports.
 *
 * Zoho is multi-DC: a user's account lives in exactly one region, and every API
 * host is region-scoped. Zoho's guidance is to never hardcode a single region —
 * the token response carries an `api_domain` naming the caller's CRM host.
 * Sim cannot persist that value (the shared Better Auth `account` table has no
 * column for provider-specific token fields), so the region is selected on the
 * block instead and resolved to hosts here.
 *
 * Only regions whose CRM *and* Desk hosts are confirmed in Zoho's own
 * documentation are listed. CA and SA are deliberately absent: Zoho's accounts
 * docs give `accounts.zohocloud.ca` while the Desk SDK uses `accounts.zoho.ca`,
 * and neither source states their CRM API host.
 *
 * @see https://www.zoho.com/crm/developer/docs/api/v8/multi-dc.html
 */
export const ZOHO_DATA_CENTERS = {
  us: { crm: 'https://www.zohoapis.com', desk: 'https://desk.zoho.com' },
  eu: { crm: 'https://www.zohoapis.eu', desk: 'https://desk.zoho.eu' },
  in: { crm: 'https://www.zohoapis.in', desk: 'https://desk.zoho.in' },
  au: { crm: 'https://www.zohoapis.com.au', desk: 'https://desk.zoho.com.au' },
  jp: { crm: 'https://www.zohoapis.jp', desk: 'https://desk.zoho.jp' },
} as const

export type ZohoDataCenter = keyof typeof ZOHO_DATA_CENTERS

const DEFAULT_DATA_CENTER: ZohoDataCenter = 'us'

/** Zoho CRM API version pinned across every CRM tool. */
export const ZOHO_CRM_API_VERSION = 'v8'

function resolveDataCenter(dataCenter?: string): ZohoDataCenter {
  const normalized = dataCenter?.trim().toLowerCase()
  if (normalized && normalized in ZOHO_DATA_CENTERS) {
    return normalized as ZohoDataCenter
  }
  return DEFAULT_DATA_CENTER
}

/**
 * Returns the CRM API base URL (including version segment) for a data center.
 * Falls back to the US region when unset or unrecognized.
 */
export function getCrmBaseUrl(dataCenter?: string): string {
  return `${ZOHO_DATA_CENTERS[resolveDataCenter(dataCenter)].crm}/crm/${ZOHO_CRM_API_VERSION}`
}

/**
 * Returns the Desk API base URL (including the `/api/v1` segment) for a data
 * center. Falls back to the US region when unset or unrecognized.
 */
export function getDeskBaseUrl(dataCenter?: string): string {
  return `${ZOHO_DATA_CENTERS[resolveDataCenter(dataCenter)].desk}/api/v1`
}

/**
 * Zoho authenticates with a bespoke scheme rather than `Bearer`.
 * @see https://www.zoho.com/crm/developer/docs/api/v8/access-refresh.html
 */
export function buildZohoHeaders(accessToken: string, orgId?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Zoho-oauthtoken ${accessToken}`,
    'Content-Type': 'application/json',
  }
  if (orgId?.trim()) {
    headers.orgId = orgId.trim()
  }
  return headers
}

/**
 * Trims a required identifier and throws when it is missing or whitespace-only,
 * so a blank value can never collapse into an empty URL path segment and send a
 * malformed request to Zoho.
 */
export function requireZohoId(value: string | undefined, label: string): string {
  const trimmed = value?.trim()
  if (!trimmed) {
    throw new Error(`${label} is required.`)
  }
  return trimmed
}

/**
 * Parses a JSON object supplied either as an object (from the LLM) or as a JSON
 * string (from a block input), and rejects anything that is not a plain object.
 */
export function parseJsonObject(
  value: unknown,
  label: string
): Record<string, unknown> | undefined {
  if (value === undefined || value === null || value === '') return undefined
  let parsed: unknown = value
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value)
    } catch {
      throw new Error(`${label} must be valid JSON.`)
    }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object.`)
  }
  return parsed as Record<string, unknown>
}

/**
 * Coerces a numeric-ish param into a positive integer, clamped to `max`.
 * Returns undefined when unset or unparseable so callers can omit the param.
 */
export function toPositiveInt(value: unknown, max: number): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 1) return undefined
  return Math.min(Math.floor(parsed), max)
}

/**
 * Appends only the defined entries of `params` to a URL's query string, so unset
 * optional params never surface as empty values Zoho would reject.
 */
export function buildQuery(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue
    search.set(key, String(value))
  }
  const query = search.toString()
  return query ? `?${query}` : ''
}

/**
 * Reads a Zoho response body as JSON, tolerating the empty bodies Zoho returns
 * for "no matching records" — CRM answers `204 No Content` on an empty list or
 * search, and Desk does the same, so a bare `response.json()` would throw on a
 * perfectly successful call.
 */
export async function readZohoJson(response: Response): Promise<any> {
  if (response.status === 204) return {}
  const text = await response.text()
  if (!text.trim()) return {}
  try {
    return JSON.parse(text)
  } catch {
    return { message: truncate(text, 500) }
  }
}

/**
 * Extracts a descriptive message from a Zoho error payload.
 *
 * CRM returns `{ code, message, status, details }`; Desk returns
 * `{ errorCode, message }`. Both are handled, with an HTTP-status fallback.
 */
export function extractZohoErrorMessage(
  data: unknown,
  status: number,
  defaultMessage: string
): string {
  const payload = data as
    | { message?: unknown; code?: unknown; errorCode?: unknown; data?: unknown }
    | undefined

  const nested = Array.isArray(payload?.data) ? payload.data[0] : undefined
  const record = (nested ?? payload) as
    | { message?: unknown; code?: unknown; errorCode?: unknown }
    | undefined

  if (record && typeof record.message === 'string' && record.message.trim()) {
    const code = record.code ?? record.errorCode
    const suffix = typeof code === 'string' && code.trim() ? ` [${code}]` : ''
    return `Zoho API Error (${status}): ${record.message}${suffix}`
  }

  switch (status) {
    case 400:
      return `Zoho API Error (400): Bad Request — the request was malformed or missing required parameters.`
    case 401:
      return `Zoho API Error (401): Unauthorized — the access token is invalid or expired. Please reconnect your Zoho account.`
    case 403:
      return `Zoho API Error (403): Forbidden — your Zoho account lacks permission, or the required OAuth scope was not granted.`
    case 404:
      return `Zoho API Error (404): Not Found — the requested record does not exist or is not visible to you.`
    case 429:
      return `Zoho API Error (429): Rate limit exceeded — too many API calls. Please retry later.`
    default:
      return `${defaultMessage} (HTTP ${status})`
  }
}
