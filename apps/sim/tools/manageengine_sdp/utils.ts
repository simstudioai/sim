import { resolveSdpBase } from '@/tools/manageengine_sdp/data-centers'
import type { SdpBaseParams, SdpListParams } from '@/tools/manageengine_sdp/types'
import { safeUrlPathSegment } from '@/tools/url-path'

/**
 * Media type ServiceDesk Plus Cloud requires on every v3 call. Sending a plain
 * `application/json` Accept returns the portal's HTML login page rather than an
 * API error, so this header is not optional.
 */
const SDP_ACCEPT = 'application/vnd.manageengine.sdp.v3+json'

/**
 * Build the v3 API base for a portal.
 *
 * SDP serves each portal from `/app/{portal}/api/v3`; omitting the portal
 * segment addresses the account's default portal, which is what the
 * data-center examples in the docs use. The portal name reaches us from a
 * free-text field, so it goes through {@link safeUrlPathSegment} before it
 * becomes a path segment.
 */
export function getSdpApiBase(params: Pick<SdpBaseParams, 'dataCenter' | 'portal'>): string {
  const base = resolveSdpBase(params.dataCenter)
  const portal = params.portal?.trim()
  if (!portal) return `${base}/api/v3`
  return `${base}/app/${safeUrlPathSegment(portal, 'Portal')}/api/v3`
}

/** Build the auth + content-negotiation headers required on every SDP call. */
export function buildSdpHeaders(
  params: Pick<SdpBaseParams, 'accessToken'>
): Record<string, string> {
  if (!params.accessToken) throw new Error('ManageEngine ServiceDesk Plus access token is required')
  return {
    Accept: SDP_ACCEPT,
    Authorization: `Zoho-oauthtoken ${params.accessToken}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  }
}

/**
 * Collapse the three "not supplied" shapes to `undefined`. The workflow
 * serializer initializes untouched subBlocks to `null`, and a cleared field
 * arrives as `''`; all three mean absent.
 */
export function orUndefined(value: unknown): unknown {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value === 'string') return value.trim() || undefined
  return value
}

/**
 * Parse a value that may already be an object/array or may be the JSON text a
 * subBlock stores. Throws with `label` named so the failure points at the
 * field, rather than reaching SDP as a string it would silently ignore.
 */
export function parseSdpJson(value: unknown, label: string): unknown {
  const resolved = orUndefined(value)
  if (resolved === undefined) return undefined
  if (typeof resolved !== 'string') return resolved
  try {
    return JSON.parse(resolved)
  } catch {
    throw new Error(`Invalid JSON provided for ${label}`)
  }
}

/**
 * Coerce a `list_info` bound to an integer at or above `min`, or `undefined`.
 * SDP answers a negative or fractional index with an opaque provider error, so
 * out-of-range values are dropped here instead of round-tripped.
 */
export function toSdpPositiveInt(value: unknown, min: number): number | undefined {
  const resolved = orUndefined(value)
  if (resolved === undefined) return undefined
  const parsed = Number(resolved)
  return Number.isInteger(parsed) && parsed >= min ? parsed : undefined
}

/** Maximum `row_count` SDP accepts on a single list call. */
export const SDP_MAX_ROW_COUNT = 100

/**
 * Build the `list_info` object every GET-list endpoint accepts.
 *
 * `row_count` is clamped rather than rejected: the docs cap it at 100, and a
 * workflow asking for 500 wants "as many as possible", not a hard failure.
 */
export function buildSdpListInfo(params: SdpListParams): Record<string, unknown> | undefined {
  const listInfo: Record<string, unknown> = {}

  const rowCount = toSdpPositiveInt(params.rowCount, 1)
  if (rowCount !== undefined) listInfo.row_count = Math.min(rowCount, SDP_MAX_ROW_COUNT)

  const startIndex = toSdpPositiveInt(params.startIndex, 1)
  if (startIndex !== undefined) listInfo.start_index = startIndex

  const sortField = orUndefined(params.sortField)
  if (sortField !== undefined) listInfo.sort_field = sortField

  const sortOrder = orUndefined(params.sortOrder)
  if (typeof sortOrder === 'string') {
    const normalized = sortOrder.toLowerCase()
    // Only the two documented directions are forwarded; anything else would
    // reach SDP as an opaque 4001 naming a field the user never typed.
    if (normalized === 'asc' || normalized === 'desc') listInfo.sort_order = normalized
  }

  const searchCriteria = parseSdpJson(params.searchCriteria, 'search criteria')
  if (searchCriteria !== undefined) listInfo.search_criteria = searchCriteria

  const fieldsRequired = parseSdpJson(params.fieldsRequired, 'required fields')
  if (fieldsRequired !== undefined) listInfo.fields_required = fieldsRequired

  if (params.getTotalCount === true) listInfo.get_total_count = true

  return Object.keys(listInfo).length > 0 ? listInfo : undefined
}

/**
 * Append the `input_data` query parameter carrying a `list_info` object.
 *
 * The docs are explicit that "list_info object must be used as parameters for
 * the requesting URL not as form data", so this is a query string even though
 * the write endpoints send the same wrapper as a form body.
 */
export function buildSdpListUrl(baseUrl: string, params: SdpListParams): string {
  const listInfo = buildSdpListInfo(params)
  if (!listInfo) return baseUrl
  const query = new URLSearchParams({ input_data: JSON.stringify({ list_info: listInfo }) })
  return `${baseUrl}?${query.toString()}`
}

/**
 * Serialize a write payload the way SDP expects it: a form body with a single
 * `input_data` field whose value is the JSON entity wrapped in its module key
 * (`{"request": {...}}`).
 */
export function buildSdpInputDataBody(entityKey: string, entity: Record<string, unknown>): string {
  return new URLSearchParams({ input_data: JSON.stringify({ [entityKey]: entity }) }).toString()
}

/**
 * Drop keys whose value is absent so an untouched optional subBlock never
 * reaches SDP as an explicit `null` (which clears the field on a PUT).
 */
export function compactSdpEntity(entity: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(entity)) {
    if (orUndefined(value) !== undefined) out[key] = value
  }
  return out
}

/**
 * SDP spells `response_status` two ways: an object on single-entity responses
 * and an array on list and bulk responses (see the bulk example in the common
 * error codes page). Normalize to the array form so error extraction reads one
 * shape.
 */
function toResponseStatusEntries(data: unknown): Record<string, unknown>[] {
  if (!data || typeof data !== 'object') return []
  const status = (data as Record<string, unknown>).response_status
  const entries = Array.isArray(status) ? status : [status]
  return entries.filter((entry): entry is Record<string, unknown> =>
    Boolean(entry && typeof entry === 'object')
  )
}

/**
 * Extract a human-readable error from an SDP error body.
 *
 * Each `response_status` entry carries a `messages` array whose items hold a
 * `message`, and sometimes only a `field` + `status_code` (see the 4005 / 4008 /
 * 4009 samples, which name the offending field but ship no prose). Both forms
 * are surfaced, because falling back to the bare HTTP status hides which field
 * SDP rejected.
 */
export function getSdpErrorMessage(data: unknown, fallback: string): string {
  const parts: string[] = []
  for (const entry of toResponseStatusEntries(data)) {
    const messages = entry.messages
    if (!Array.isArray(messages)) continue
    for (const message of messages) {
      if (!message || typeof message !== 'object') continue
      const { message: text, field, status_code: statusCode } = message as Record<string, unknown>
      const prose = typeof text === 'string' && text.trim() ? text.trim() : undefined
      const fieldName = typeof field === 'string' && field.trim() ? field.trim() : undefined
      const code = typeof statusCode === 'number' ? `code ${statusCode}` : undefined
      const detail = prose ?? code
      if (!detail) continue
      parts.push(fieldName ? `${fieldName}: ${detail}` : detail)
    }
  }
  return parts.length > 0 ? parts.join('; ') : fallback
}

/**
 * Read the JSON body and throw a descriptive error when the call failed.
 *
 * SDP answers a failed call with a non-2xx status AND a `status: "failed"`
 * body, but the bulk form can also return HTTP 200 with per-entity failures, so
 * `response.ok` alone is not a sufficient success test on write endpoints.
 */
export async function parseSdpResponse(
  response: Response,
  fallbackMessage: string
): Promise<Record<string, unknown>> {
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>
  if (!response.ok) {
    throw new Error(getSdpErrorMessage(data, `${fallbackMessage} (HTTP ${response.status})`))
  }
  const failed = toResponseStatusEntries(data).some((entry) => entry.status === 'failed')
  if (failed) {
    throw new Error(getSdpErrorMessage(data, fallbackMessage))
  }
  return data
}

/**
 * Read the `list_info` echoed back on a list response, or `undefined` when the
 * endpoint omitted it.
 */
export function readSdpListInfo(
  data: Record<string, unknown>
): Record<string, unknown> | undefined {
  const listInfo = data.list_info
  return listInfo && typeof listInfo === 'object' && !Array.isArray(listInfo)
    ? (listInfo as Record<string, unknown>)
    : undefined
}

/**
 * Read the array a list response carries under its module key, tolerating an
 * endpoint that returns no rows at all rather than an empty array.
 */
export function readSdpList(data: Record<string, unknown>, key: string): unknown[] {
  const value = data[key]
  return Array.isArray(value) ? value : []
}

/**
 * Address a user-valued field (requester, technician) by email address.
 *
 * SDP resolves `{ email_id }` to the matching portal user, which keeps these
 * tools usable from an agent that knows who a ticket is for but not their
 * internal SDP id.
 */
export function toSdpUserReference(email: unknown): Record<string, string> | undefined {
  const resolved = orUndefined(email)
  return typeof resolved === 'string' ? { email_id: resolved } : undefined
}

/**
 * Address a lookup field (status, priority, category, ...) by its display name,
 * which SDP resolves against the portal's own picklist.
 */
export function toSdpNameReference(name: unknown): Record<string, string> | undefined {
  const resolved = orUndefined(name)
  return typeof resolved === 'string' ? { name: resolved } : undefined
}

/**
 * Build the `{ value }` datetime object SDP expects, where `value` is epoch
 * milliseconds as a string (getting-started/input-data.html: "The time in long
 * format (No. of milliseconds from Jan 1, 1970)").
 *
 * Accepts an ISO 8601 string or an epoch-millisecond number/string, since a
 * workflow may carry either. `display_value` is deliberately not sent — SDP
 * renders it from `value` in the portal's own timezone, and supplying a
 * conflicting one would be ambiguous.
 *
 * @throws If the value is present but not a parseable date, so a typo fails
 * loudly here instead of silently scheduling nothing.
 */
export function toSdpDateTime(value: unknown, label: string): Record<string, string> | undefined {
  const resolved = orUndefined(value)
  if (resolved === undefined) return undefined

  // A bare integer (or integer-like string) is already epoch milliseconds.
  // Date.parse would read "1478758440000" as an invalid date, so check first.
  if (typeof resolved === 'number' && Number.isFinite(resolved)) {
    return { value: String(Math.trunc(resolved)) }
  }
  const text = String(resolved).trim()
  if (/^\d+$/.test(text)) return { value: text }

  const parsed = Date.parse(text)
  if (Number.isNaN(parsed)) {
    throw new Error(`${label} must be an ISO 8601 timestamp or epoch milliseconds`)
  }
  return { value: String(parsed) }
}
