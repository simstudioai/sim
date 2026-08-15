import type { CreateSloParams, DatadogSite, SecuritySignalTriageData } from '@/tools/datadog/types'

/**
 * Builds a fully-qualified Datadog API URL for the caller's site/region.
 * Datadog serves each region from its own host (`datadoghq.com`, `datadoghq.eu`,
 * `ddog-gov.com`, ...), so every request must be built from the configured site.
 */
export function datadogApiUrl(site: DatadogSite | undefined, path: string): string {
  return `https://api.${site || 'datadoghq.com'}${path}`
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

/**
 * Extracts a human-readable message from a failed Datadog response.
 * Datadog returns `{ errors: [...] }` where entries are either plain strings (v1)
 * or JSON:API error objects with a `detail`/`title` (v2).
 */
export async function datadogErrorMessage(response: Response): Promise<string> {
  const fallback = `HTTP ${response.status}: ${response.statusText}`
  const body = await response.json().catch(() => null)
  const errors = (body as { errors?: unknown })?.errors
  if (Array.isArray(errors) && errors.length > 0) {
    const messages = errors
      .map((entry) => {
        if (typeof entry === 'string') return entry
        if (entry && typeof entry === 'object') {
          const record = entry as { detail?: unknown; title?: unknown }
          if (typeof record.detail === 'string') return record.detail
          if (typeof record.title === 'string') return record.title
        }
        return null
      })
      .filter((message): message is string => Boolean(message))
    if (messages.length > 0) return messages.join('; ')
  }
  return fallback
}

/** Splits a comma-separated user input into a trimmed, non-empty list. */
export function splitCommaList(value: string | undefined): string[] | undefined {
  if (!value) return undefined
  const items = value
    .split(',')
    .map((item) => item.trim())
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
 * Builds the `ServiceLevelObjective` request body shared by SLO create and update.
 * Datadog's `PUT /api/v1/slo/{slo_id}` is a full replacement, so both operations
 * send the same required fields (`name`, `type`, `thresholds`).
 */
export function buildSloPayload(params: CreateSloParams): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: params.name,
    type: params.type,
    thresholds: parseJsonParam<unknown[]>(params.thresholds, 'thresholds parameter') ?? [],
  }

  if (params.description) body.description = params.description

  const tags = splitCommaList(params.tags)
  if (tags) body.tags = tags

  const query = parseJsonParam<Record<string, unknown>>(params.query, 'query parameter')
  if (query) body.query = query

  const monitorIds = splitCommaList(params.monitorIds)
  if (monitorIds) body.monitor_ids = monitorIds.map((id) => Number(id))

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
  const payload = (data as { data?: Record<string, any> })?.data ?? {}
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
