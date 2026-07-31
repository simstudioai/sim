import type {
  LogfireBaseParams,
  LogfireColumn,
  LogfireQueryApiResponse,
  LogfireRecord,
  LogfireRegion,
} from '@/tools/logfire/types'

const REGION_BASE_URLS = {
  us: 'https://logfire-us.pydantic.dev',
  eu: 'https://logfire-eu.pydantic.dev',
} as const

type LogfireCloudRegion = keyof typeof REGION_BASE_URLS

const isCloudRegion = (value: string): value is LogfireCloudRegion =>
  Object.hasOwn(REGION_BASE_URLS, value)

/** Logfire read tokens carry their region as a `pylf_v{n}_{region}_` prefix. */
const TOKEN_REGION_PATTERN = /^pylf_v\d+_([a-z]+)_/

/** SQL query endpoint, relative to the regional base URL. */
export const LOGFIRE_QUERY_PATH = '/v2/query'

/** Read token introspection endpoint, relative to the regional base URL. */
export const LOGFIRE_READ_TOKEN_INFO_PATH = '/v1/read-token-info'

/**
 * Logfire requires `min_timestamp` on every query. When the caller leaves the
 * window open, fall back to the same floor the official Logfire SDK uses.
 */
const LOGFIRE_MIN_TIMESTAMP_FALLBACK = '2020-01-01T00:00:00Z'

/** Row limits Logfire enforces on `/v2/query`. */
const LOGFIRE_MAX_LIMIT = 10000
const LOGFIRE_MIN_LIMIT = 1

/**
 * Fixed `records` projection shared by the search and trace tools. Every column
 * is documented in the Logfire SQL reference; `level` is read through
 * `level_name` so rows carry the readable severity rather than its number.
 */
export const LOGFIRE_RECORD_PROJECTION = [
  'start_timestamp',
  'end_timestamp',
  'duration',
  'level_name(level) AS level',
  'message',
  'span_name',
  'kind',
  'service_name',
  'deployment_environment',
  'trace_id',
  'span_id',
  'parent_span_id',
  'is_exception',
  'exception_type',
  'exception_message',
].join(', ')

/**
 * Normalize a self-hosted base URL. Assumes HTTPS when no scheme is given and
 * drops trailing slashes so endpoint paths concatenate cleanly. A sub-path is
 * preserved, so instances served under a prefix keep working.
 *
 * Rejects anything that would retarget the request once an endpoint path is
 * appended — a query string or fragment silently swallows the path, and
 * userinfo (`host@elsewhere`) sends the read token to a different origin.
 *
 * Note the platform only dispatches tool requests to publicly resolvable HTTPS
 * hosts, so an instance on a private network or plain HTTP is rejected later by
 * the executor regardless of what this accepts.
 */
function normalizeHost(host?: string): string | undefined {
  const trimmed = host?.trim()
  if (!trimmed) return undefined

  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`

  let parsed: URL
  try {
    parsed = new URL(withScheme)
  } catch {
    throw new Error(`Invalid Logfire host: ${trimmed}`)
  }

  if (parsed.search || parsed.hash) {
    throw new Error('Logfire host must not include a query string or fragment')
  }
  if (parsed.username || parsed.password) {
    throw new Error('Logfire host must not include credentials')
  }

  return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, '')
}

/**
 * Resolve the API base URL. A self-hosted host wins outright; otherwise an
 * explicit region wins; otherwise the region is read from the token prefix.
 * Tokens minted before regions existed carry no prefix and are US.
 */
export function getLogfireBaseUrl(apiKey: string, region?: LogfireRegion, host?: string): string {
  const selfHosted = normalizeHost(host)
  if (selfHosted) return selfHosted

  if (region && region !== 'auto') {
    if (!isCloudRegion(region)) {
      throw new Error(
        `Unrecognized Logfire region '${region}'. Set Region to us or eu, or set Host explicitly.`
      )
    }
    return REGION_BASE_URLS[region]
  }

  const detected = TOKEN_REGION_PATTERN.exec(apiKey?.trim() ?? '')?.[1]
  if (!detected) return REGION_BASE_URLS.us
  if (!isCloudRegion(detected)) {
    throw new Error(
      `Unrecognized Logfire token region '${detected}'. Set Region or Host explicitly.`
    )
  }
  return REGION_BASE_URLS[detected]
}

/**
 * Resolve the full endpoint URL for a tool request.
 *
 * Note the `apiKey`/`region`/`host` param declarations are deliberately repeated
 * in each tool rather than spread from a shared constant: the docs generator
 * parses each `params` object literal statically, so a spread would drop those
 * three rows from every generated input table.
 */
export const logfireUrl = (params: LogfireBaseParams, path: string): string =>
  `${getLogfireBaseUrl(params.apiKey, params.region, params.host)}${path}`

export const logfireHeaders = (apiKey: string): Record<string, string> => ({
  Authorization: `Bearer ${apiKey.trim()}`,
  'Content-Type': 'application/json',
  Accept: 'application/json',
})

export const cleanOptionalString = (value?: string): string | undefined => {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

/** Escape a value for use as a single-quoted SQL string literal. */
export const sqlLiteral = (value: string): string => `'${value.replace(/'/g, "''")}'`

/**
 * Case-insensitive literal substring match.
 *
 * Uses DataFusion's `contains` rather than `LIKE`/`ILIKE` so `%` and `_` in user
 * input stay literal without needing a second escaping pass on top of
 * {@link sqlLiteral}. `contains` matches literally as of DataFusion 43 (earlier
 * versions compiled the needle as a regex) and is case-sensitive, hence
 * `lower()` on both sides.
 */
export const sqlContains = (column: string, value: string): string =>
  `contains(lower(${column}), ${sqlLiteral(value.toLowerCase())})`

/** Matches a trailing UTC designator or numeric offset, e.g. `Z`, `+00:00`, `-0530`. */
const TIMESTAMP_OFFSET_PATTERN = /(?:[Zz]|[+-]\d{2}:?\d{2})$/
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/**
 * Logfire rejects a naive timestamp — the value must carry an offset. Assume UTC
 * when none is given, matching the official SDK, and widen a bare date to
 * midnight so a date-only input is accepted rather than failing the query.
 */
function normalizeTimestamp(value?: string): string | undefined {
  const trimmed = cleanOptionalString(value)
  if (!trimmed) return undefined
  if (DATE_ONLY_PATTERN.test(trimmed)) return `${trimmed}T00:00:00Z`
  return TIMESTAMP_OFFSET_PATTERN.test(trimmed) ? trimmed : `${trimmed}Z`
}

interface LogfireQueryBodyInput {
  sql: string
  minTimestamp?: string
  maxTimestamp?: string
  limit?: number
  timezone?: string
  environment?: string
}

export function buildLogfireQueryBody(input: LogfireQueryBodyInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    sql: input.sql,
    min_timestamp: normalizeTimestamp(input.minTimestamp) ?? LOGFIRE_MIN_TIMESTAMP_FALLBACK,
    include_schema: true,
  }

  const maxTimestamp = normalizeTimestamp(input.maxTimestamp)
  if (maxTimestamp) body.max_timestamp = maxTimestamp

  if (input.limit !== undefined && Number.isFinite(input.limit)) {
    body.limit = Math.min(Math.max(Math.trunc(input.limit), LOGFIRE_MIN_LIMIT), LOGFIRE_MAX_LIMIT)
  }

  const timezone = cleanOptionalString(input.timezone)
  if (timezone) body.timezone = timezone

  const environment = cleanOptionalString(input.environment)
  if (environment) body.deployment_environment = [environment]

  return body
}

/**
 * Read a successful Logfire body. Non-OK responses never reach here — the tool
 * executor surfaces those before `transformResponse` runs.
 */
export async function parseLogfireResponse<T>(response: Response): Promise<T> {
  try {
    return (await response.json()) as T
  } catch {
    throw new Error('Logfire returned a response that is not valid JSON')
  }
}

const asString = (value: unknown): string | null => (typeof value === 'string' ? value : null)
const asNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null
const asBoolean = (value: unknown): boolean | null => (typeof value === 'boolean' ? value : null)

export const extractLogfireRows = (results: LogfireQueryApiResponse): Record<string, unknown>[] =>
  results.data ?? []

export const extractLogfireColumns = (results: LogfireQueryApiResponse): LogfireColumn[] =>
  results.schema?.fields?.map((field) => ({
    name: field.name ?? null,
    datatype: field.data_type ?? null,
    nullable: field.nullable ?? null,
  })) ?? []

export const normalizeLogfireRecord = (row: Record<string, unknown>): LogfireRecord => ({
  startTimestamp: asString(row.start_timestamp),
  endTimestamp: asString(row.end_timestamp),
  duration: asNumber(row.duration),
  level: asString(row.level),
  message: asString(row.message),
  spanName: asString(row.span_name),
  kind: asString(row.kind),
  serviceName: asString(row.service_name),
  deploymentEnvironment: asString(row.deployment_environment),
  traceId: asString(row.trace_id),
  spanId: asString(row.span_id),
  parentSpanId: asString(row.parent_span_id),
  isException: asBoolean(row.is_exception),
  exceptionType: asString(row.exception_type),
  exceptionMessage: asString(row.exception_message),
})
