import { truncate } from '@sim/utils/string'

/**
 * Identity reported to the Temporal server on write operations so they are
 * attributable in workflow histories.
 */
export const TEMPORAL_CLIENT_IDENTITY = 'sim'

const JSON_PLAIN_ENCODING = Buffer.from('json/plain').toString('base64')

/** A Temporal `common.v1.Payload` as serialized by the HTTP API (base64 fields). */
export interface TemporalPayload {
  metadata?: Record<string, string>
  data?: string
}

/** A Temporal `common.v1.Payloads` collection. */
export interface TemporalPayloads {
  payloads?: TemporalPayload[]
}

/** Raw `common.v1.WorkflowExecution` shape returned by the HTTP API. */
export interface TemporalRawExecution {
  workflowId?: string
  runId?: string
}

/** Raw `workflow.v1.WorkflowExecutionInfo` shape returned by describe/list responses. */
export interface TemporalRawExecutionInfo {
  execution?: TemporalRawExecution
  type?: { name?: string }
  status?: string
  startTime?: string
  closeTime?: string
  executionTime?: string
  historyLength?: string
  taskQueue?: string
}

/** Raw `history.v1.HistoryEvent` shape returned by the workflow history endpoint. */
export interface TemporalRawHistoryEvent {
  eventId?: string
  eventTime?: string
  eventType?: string
  [key: string]: unknown
}

/**
 * Builds the `/api/v1/namespaces/{namespace}` base URL for a Temporal server's HTTP API,
 * tolerating surrounding whitespace and trailing slashes on the server URL
 * (e.g. `http://localhost:7243/` → `http://localhost:7243/api/v1/namespaces/default`).
 */
export function temporalNamespaceUrl(serverUrl: string, namespace: string): string {
  const base = serverUrl.trim().replace(/\/+$/, '')
  return `${base}/api/v1/namespaces/${encodeURIComponent(namespace.trim())}`
}

/**
 * Builds the `/workflows/{workflowId}` URL for a workflow execution, trimming and
 * URL-encoding the workflow ID.
 */
export function temporalWorkflowUrl(
  serverUrl: string,
  namespace: string,
  workflowId: string
): string {
  return `${temporalNamespaceUrl(serverUrl, namespace)}/workflows/${encodeURIComponent(workflowId.trim())}`
}

/**
 * Builds the `/schedules/{scheduleId}` URL for a schedule, trimming and URL-encoding
 * the schedule ID.
 */
export function temporalScheduleUrl(
  serverUrl: string,
  namespace: string,
  scheduleId: string
): string {
  return `${temporalNamespaceUrl(serverUrl, namespace)}/schedules/${encodeURIComponent(scheduleId.trim())}`
}

/**
 * Builds a `common.v1.WorkflowExecution` reference with trimmed IDs, omitting the run ID
 * when not provided so the server targets the latest run.
 */
export function workflowExecutionRef(workflowId: string, runId?: string): Record<string, string> {
  const ref: Record<string, string> = { workflowId: workflowId.trim() }
  if (runId?.trim()) ref.runId = runId.trim()
  return ref
}

/**
 * Builds the request headers for a Temporal HTTP API call, attaching the API key as a
 * Bearer token when one is provided (omitted for servers without authentication).
 *
 * The Accept header opts out of the server's payload "shorthand" JSON form so responses
 * always carry full `{metadata, data}` payload objects that {@link decodePayload} understands.
 */
export function temporalRequestHeaders(params: { apiKey?: string }): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json+no-payload-shorthand',
  }
  if (params.apiKey) headers.Authorization = `Bearer ${params.apiKey.trim()}`
  return headers
}

/** Encodes a single JSON value as a Temporal `json/plain` payload. */
export function encodePayload(value: unknown): TemporalPayload {
  return {
    metadata: { encoding: JSON_PLAIN_ENCODING },
    data: Buffer.from(JSON.stringify(value)).toString('base64'),
  }
}

/**
 * Normalizes a JSON field value: strings are parsed as JSON, already-resolved objects
 * and arrays are used as-is, and empty input returns undefined so the field is omitted.
 */
function parseJsonValue(value: unknown, fieldName: string): unknown {
  if (value == null) return undefined
  if (typeof value === 'string') {
    if (!value.trim()) return undefined
    try {
      return JSON.parse(value)
    } catch {
      throw new Error(`Invalid JSON in ${fieldName}`)
    }
  }
  return value
}

/**
 * Parses a JSON value into Temporal `Payloads`. A top-level array is treated as the
 * argument list (one payload per element); any other value becomes a single argument.
 * Returns undefined for empty input so optional payload fields can be omitted entirely.
 */
export function parseJsonArgs(value: unknown, fieldName: string): TemporalPayloads | undefined {
  const parsed = parseJsonValue(value, fieldName)
  if (parsed === undefined) return undefined
  const args = Array.isArray(parsed) ? parsed : [parsed]
  return { payloads: args.map(encodePayload) }
}

/**
 * Parses a JSON object value into a `map<string, Payload>` (memo fields or search
 * attribute indexed fields). Returns undefined for empty input.
 */
export function parseJsonPayloadMap(
  value: unknown,
  fieldName: string
): Record<string, TemporalPayload> | undefined {
  const parsed = parseJsonValue(value, fieldName)
  if (parsed === undefined) return undefined
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${fieldName} must be a JSON object`)
  }
  return Object.fromEntries(
    Object.entries(parsed as Record<string, unknown>).map(([key, value]) => [
      key,
      encodePayload(value),
    ])
  )
}

/**
 * Decodes a single Temporal payload: `json/plain` and `json/protobuf` payloads are parsed
 * to their JSON value, `binary/null` becomes null, and unknown encodings are returned as
 * the original base64 data string.
 */
export function decodePayload(payload: TemporalPayload | undefined): unknown {
  if (!payload) return null
  const encoding = payload.metadata?.encoding
    ? Buffer.from(payload.metadata.encoding, 'base64').toString('utf8')
    : undefined
  if (encoding === 'binary/null') return null
  if (payload.data == null) return null
  if (encoding === 'json/plain' || encoding === 'json/protobuf') {
    const raw = Buffer.from(payload.data, 'base64').toString('utf8')
    try {
      return JSON.parse(raw)
    } catch {
      return raw
    }
  }
  return payload.data
}

/** Decodes a Temporal `Payloads` collection into an array of JSON values. */
export function decodePayloads(payloads: TemporalPayloads | undefined): unknown[] {
  return (payloads?.payloads ?? []).map(decodePayload)
}

/** Decodes a `map<string, Payload>` (memo / search attributes) into a plain object. */
export function decodePayloadMap(
  fields: Record<string, TemporalPayload> | undefined
): Record<string, unknown> | null {
  if (!fields) return null
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, decodePayload(value)])
  )
}

/** Strips a protobuf enum prefix (e.g. `WORKFLOW_EXECUTION_STATUS_RUNNING` → `RUNNING`). */
export function stripEnumPrefix(value: string | undefined, prefix: string): string | null {
  if (!value) return null
  return value.startsWith(prefix) ? value.slice(prefix.length) : value
}

/**
 * Formats a seconds count as a protobuf JSON duration string (e.g. 3600 → `"3600s"`).
 * Returns undefined for missing, non-numeric, or non-positive values so the field is omitted.
 */
export function toDurationString(seconds: number | string | undefined): string | undefined {
  if (seconds == null || seconds === '') return undefined
  const parsed = Number(seconds)
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined
  return `${parsed}s`
}

/**
 * Maps a raw `WorkflowExecutionInfo` to the flat execution summary shared by the
 * describe and list tools. int64 fields arrive as JSON strings and are coerced to numbers.
 */
export function mapExecutionInfo(info: TemporalRawExecutionInfo | undefined) {
  return {
    workflowId: info?.execution?.workflowId ?? null,
    runId: info?.execution?.runId ?? null,
    workflowType: info?.type?.name ?? null,
    status: stripEnumPrefix(info?.status, 'WORKFLOW_EXECUTION_STATUS_'),
    startTime: info?.startTime ?? null,
    closeTime: info?.closeTime ?? null,
    executionTime: info?.executionTime ?? null,
    historyLength: info?.historyLength != null ? Number(info.historyLength) : null,
    taskQueue: info?.taskQueue ?? null,
  }
}

/**
 * Maps a raw history event to a flat shape, extracting the event's `*EventAttributes`
 * object (each event carries exactly one, keyed by its type).
 */
export function mapHistoryEvent(event: TemporalRawHistoryEvent) {
  const attributesKey = Object.keys(event).find((key) => key.endsWith('EventAttributes'))
  return {
    eventId: event.eventId != null ? Number(event.eventId) : null,
    eventTime: event.eventTime ?? null,
    eventType: stripEnumPrefix(event.eventType, 'EVENT_TYPE_'),
    attributes: attributesKey ? ((event[attributesKey] as Record<string, unknown>) ?? null) : null,
  }
}

/**
 * Parses a Temporal HTTP API response body and throws a descriptive error for non-2xx
 * replies. grpc-gateway errors carry a top-level `message` field; empty bodies (returned
 * by signal/cancel/terminate) parse to an empty object.
 */
export async function parseTemporalResponse<T extends object>(
  response: Response,
  operation: string
): Promise<T> {
  const text = await response.text()
  let data: Record<string, unknown> = {}
  if (text) {
    try {
      data = JSON.parse(text) as Record<string, unknown>
    } catch {
      data = { message: truncate(text, 300) }
    }
  }
  if (!response.ok) {
    const message =
      typeof data.message === 'string' && data.message ? data.message : `HTTP ${response.status}`
    throw new Error(`Temporal ${operation} failed: ${message}`)
  }
  return data as T
}
