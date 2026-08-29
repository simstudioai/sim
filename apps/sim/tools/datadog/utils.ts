import type {
  CreateSloParams,
  DatadogSite,
  SecuritySignalTriageData,
  UpdateSloParams,
} from '@/tools/datadog/types'
import { DATADOG_SITES } from '@/tools/datadog/types'

/**
 * Builds a fully-qualified Datadog API URL for the caller's site/region.
 * Datadog serves each region from its own host (`datadoghq.com`, `datadoghq.eu`,
 * `ddog-gov.com`, ...), so every request must be built from the configured site.
 */
export function datadogApiUrl(site: DatadogSite | undefined, path: string): string {
  return `https://api.${resolveDatadogSite(site)}${path}`
}

/**
 * Resolves the caller's `site` to one of Datadog's published regional hosts.
 *
 * `DatadogSite` is a compile-time union, so it constrains nothing at runtime: the
 * value is interpolated into the request host, and every Datadog request carries
 * `DD-API-KEY` and `DD-APPLICATION-KEY`. An unchecked value therefore decides where
 * the workspace's Datadog credentials are sent — `evil.com` addresses `api.evil.com`,
 * and `datadoghq.com@evil.com` addresses `evil.com` with the expected host as
 * userinfo. The block renders `site` as a dropdown and the param is `user-only`, so
 * neither the editor nor a model can reach this today; the check exists because the
 * value survives in stored workflow state, which imports and programmatic edits write
 * without passing through that dropdown.
 *
 * Typed `unknown` rather than `DatadogSite`: the declared type is exactly what this
 * cannot trust, and a stored workflow can hand over a blank string or a non-string.
 *
 * @param site - The caller-supplied site, or `undefined`/blank for the default region.
 * @returns The validated site host.
 * @throws If the value is present but is not a published Datadog site.
 */
export function resolveDatadogSite(site: unknown): DatadogSite {
  if (site === undefined || site === null || site === '') return 'datadoghq.com'
  if (typeof site !== 'string' || !(DATADOG_SITES as readonly string[]).includes(site)) {
    throw new Error(
      `Datadog "site" must be one of ${DATADOG_SITES.join(', ')}, but was ${String(site)}`
    )
  }
  return site as DatadogSite
}

/**
 * Encodes one user-supplied identifier for use as a URL path segment.
 *
 * IDs reach Sim by copy/paste and from `<Block.output>` references, so they arrive with
 * stray whitespace and as non-strings (a monitor ID is a number). `encodeURIComponent`
 * preserves the whitespace as `%20`, which Datadog treats as part of the ID and answers
 * with a 404 that names nothing the user typed — so trim before encoding.
 */
export function datadogPathSegment(value: unknown): string {
  return encodeURIComponent(String(value ?? '').trim())
}

/** Standard Datadog authentication headers for API + application key auth. */
export function datadogHeaders(params: {
  apiKey: string
  applicationKey: string
}): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'DD-API-KEY': params.apiKey,
    'DD-APPLICATION-KEY': params.applicationKey,
  }
}

/** Reads one Datadog error entry, which is a plain string (v1) or a JSON:API object (v2). */
function errorEntryMessage(entry: unknown): string | null {
  if (typeof entry === 'string') return entry
  if (entry && typeof entry === 'object') {
    const record = entry as { detail?: unknown; title?: unknown }
    if (typeof record.detail === 'string') return record.detail
    if (typeof record.title === 'string') return record.title
  }
  return null
}

/**
 * Extracts a human-readable message from a failed Datadog response.
 *
 * Datadog returns `{ errors: ... }` in three shapes: an array of plain strings (v1),
 * an array of JSON:API error objects carrying `detail`/`title` (v2), and — on the SLO
 * delete conflict — a dictionary keyed by resource ID whose values are the reasons.
 */
export async function datadogErrorMessage(response: Response): Promise<string> {
  const fallback = `HTTP ${response.status}: ${response.statusText}`
  const body = await response.json().catch(() => null)
  const errors = (body as { errors?: unknown })?.errors

  const entries = Array.isArray(errors)
    ? errors
    : errors && typeof errors === 'object'
      ? Object.values(errors as Record<string, unknown>)
      : []

  const messages = entries
    .map(errorEntryMessage)
    .filter((message): message is string => Boolean(message))

  return messages.length > 0 ? messages.join('; ') : fallback
}

/**
 * Splits a comma-separated user input into a trimmed, non-empty list.
 *
 * Accepts `unknown` because a `<Block.output>` reference can resolve to a non-string:
 * a monitor ID read from `get_monitor` arrives as a number, and an LLM tool call can
 * pass an array. Calling `.split` on those would throw before the request is built.
 */
export function splitCommaList(value: unknown): string[] | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const items = (Array.isArray(value) ? value : String(value).split(','))
    .map((item) => String(item).trim())
    .filter((item) => item.length > 0)
  return items.length > 0 ? items : undefined
}

/**
 * Parses a JSON param, throwing a descriptive error when it is malformed.
 * Block inputs arrive as strings, but an upstream block reference can resolve to
 * an already-parsed object, so both shapes are accepted.
 */
export function parseJsonParam<T>(value: unknown, fieldName: string): T | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string') return value as T
  try {
    return JSON.parse(value) as T
  } catch {
    throw new Error(`${fieldName} must be valid JSON`)
  }
}

/**
 * Parses a comma-separated monitor ID list into the integers Datadog expects.
 * `Number('abc')` yields `NaN`, which `JSON.stringify` writes as `null` and Datadog
 * rejects with a message that names nothing the user typed, so bad input is rejected here.
 */
export function parseMonitorIds(value: unknown): number[] | undefined {
  const items = splitCommaList(value)
  if (!items) return undefined
  return items.map((id) => {
    const parsed = Number(id)
    if (!Number.isInteger(parsed)) {
      throw new Error(`monitorIds must be a comma-separated list of whole numbers (got "${id}")`)
    }
    return parsed
  })
}

/**
 * Builds the `ServiceLevelObjective` request body for SLO creation.
 */
export function buildSloPayload(params: CreateSloParams): Record<string, unknown> {
  const thresholds = parseJsonParam<unknown[]>(params.thresholds, 'thresholds parameter')
  if (!Array.isArray(thresholds) || thresholds.length === 0) {
    throw new Error('thresholds must be a non-empty JSON array')
  }

  const body: Record<string, unknown> = {
    name: params.name,
    type: params.type,
    thresholds,
  }

  if (params.description) body.description = params.description

  const tags = splitCommaList(params.tags)
  if (tags) body.tags = tags

  const query = parseJsonParam<Record<string, unknown>>(params.query, 'query parameter')
  if (query) body.query = query

  const monitorIds = parseMonitorIds(params.monitorIds)
  if (monitorIds) body.monitor_ids = monitorIds

  const groups = splitCommaList(params.groups)
  if (groups) body.groups = groups

  if (params.targetThreshold !== undefined) body.target_threshold = params.targetThreshold
  if (params.warningThreshold !== undefined) body.warning_threshold = params.warningThreshold
  if (params.timeframe) body.timeframe = params.timeframe

  return body
}

/**
 * Fields Datadog computes and rejects or ignores on an SLO update request.
 * They must be stripped from a stored SLO before it is replayed into `PUT /api/v1/slo/{slo_id}`.
 */
const SLO_READ_ONLY_FIELDS = ['id', 'created_at', 'modified_at', 'creator', 'monitor_tags'] as const

/**
 * Merges user-supplied SLO edits onto the SLO Datadog currently stores.
 *
 * `PUT /api/v1/slo/{slo_id}` is a full replacement, not a patch, so a request built
 * only from the fields the user filled in silently erases every field they left
 * blank. Reading the stored SLO first and overlaying only the supplied fields keeps
 * an edit to one field from destroying the rest.
 */
export function mergeSloUpdatePayload(
  stored: Record<string, unknown>,
  params: UpdateSloParams
): Record<string, unknown> {
  const body: Record<string, unknown> = { ...stored }
  for (const field of SLO_READ_ONLY_FIELDS) delete body[field]

  const thresholds = parseJsonParam<unknown[]>(params.thresholds, 'thresholds parameter')
  if (thresholds !== undefined) {
    if (!Array.isArray(thresholds) || thresholds.length === 0) {
      throw new Error('thresholds must be a non-empty JSON array')
    }
    body.thresholds = thresholds
  }

  if (params.name) body.name = params.name
  if (params.type) body.type = params.type
  if (params.description !== undefined && params.description !== '') {
    body.description = params.description
  }

  const tags = splitCommaList(params.tags)
  if (tags) body.tags = tags

  const query = parseJsonParam<Record<string, unknown>>(params.query, 'query parameter')
  if (query) body.query = query

  const monitorIds = parseMonitorIds(params.monitorIds)
  if (monitorIds) body.monitor_ids = monitorIds

  const groups = splitCommaList(params.groups)
  if (groups) body.groups = groups

  if (params.targetThreshold !== undefined) body.target_threshold = params.targetThreshold
  if (params.warningThreshold !== undefined) body.warning_threshold = params.warningThreshold
  if (params.timeframe) body.timeframe = params.timeframe

  return body
}

/**
 * Projects a security signal triage response (`PATCH .../state` and `.../assignee`
 * both return `SecurityMonitoringSignalTriageUpdateResponse`) onto a flat shape.
 */
export function mapSignalTriageData(data: unknown): SecuritySignalTriageData {
  const payload =
    (
      data as {
        data?: {
          id?: string
          type?: string
          attributes?: {
            state?: string
            assignee?: SecuritySignalTriageData['assignee']
            incident_ids?: number[]
            archive_reason?: string
            archive_comment?: string
            state_update_timestamp?: number
          }
        }
      }
    )?.data ?? {}
  const attributes = payload.attributes ?? {}
  return {
    id: payload.id,
    type: payload.type,
    state: attributes.state,
    assignee: attributes.assignee,
    incidentIds: attributes.incident_ids,
    archiveReason: attributes.archive_reason,
    archiveComment: attributes.archive_comment,
    stateUpdateTimestamp: attributes.state_update_timestamp,
  }
}
