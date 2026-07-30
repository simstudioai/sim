import type { ToolOutputProperty, ToolResponse } from '@/tools/types'

/**
 * Logfire data region. `auto` resolves the region from the read token's
 * `pylf_v{n}_{region}_` prefix, matching the official Logfire SDK.
 */
export type LogfireRegion = 'auto' | 'us' | 'eu'

/**
 * Severity names Logfire accepts in `level` comparisons. Logfire stores the
 * level as an OpenTelemetry severity number but rewrites string comparisons,
 * so `level >= 'error'` works directly in SQL.
 */
export type LogfireLevel = 'trace' | 'debug' | 'info' | 'notice' | 'warn' | 'error' | 'fatal'

export interface LogfireBaseParams {
  apiKey: string
  region?: LogfireRegion
  /**
   * Base URL of a self-hosted Logfire instance, e.g. `https://logfire.example.com`.
   * Takes precedence over `region`. Leave unset for Logfire Cloud.
   */
  host?: string
}

/** Time-window and paging controls accepted by every `/v2/query` request. */
export interface LogfireQueryWindowParams {
  minTimestamp?: string
  maxTimestamp?: string
  limit?: number
}

/** Column metadata returned alongside the rows of a query result. */
export interface LogfireColumn {
  name: string | null
  datatype: unknown
  nullable: boolean | null
}

/**
 * Column metadata exactly as `/v2/query` sends it. The wire key is `data_type`;
 * the official SDK renames it to `datatype` before handing results to callers,
 * and {@link LogfireColumn} keeps that friendlier name.
 */
export interface LogfireApiField {
  name?: string | null
  data_type?: unknown
  nullable?: boolean | null
}

/**
 * Raw `/v2/query` response for `Accept: application/json`. Rows arrive under
 * `data` and column metadata under `schema.fields`. Every request sets
 * `include_schema: true`, matching the official SDK.
 */
export interface LogfireQueryApiResponse {
  schema?: { fields?: LogfireApiField[] | null } | null
  data?: Record<string, unknown>[] | null
}

/** Shape of `GET /v1/read-token-info`. */
export interface LogfireReadTokenInfo {
  organization_name?: string | null
  project_name?: string | null
}

/**
 * A row from the fixed `records` projection shared by the search and trace
 * tools. Field names match the `records` table columns Logfire documents.
 */
export interface LogfireRecord {
  startTimestamp: string | null
  endTimestamp: string | null
  duration: number | null
  level: string | null
  message: string | null
  spanName: string | null
  kind: string | null
  serviceName: string | null
  deploymentEnvironment: string | null
  traceId: string | null
  spanId: string | null
  parentSpanId: string | null
  isException: boolean | null
  exceptionType: string | null
  exceptionMessage: string | null
}

/**
 * Output schema for one {@link LogfireRecord}. Kept beside the interface it
 * describes so the two stay in step, and in this file because the docs
 * generator only resolves `items:` const references from a tool's `types.ts`.
 */
export const LOGFIRE_RECORD_OUTPUT_ITEM: NonNullable<ToolOutputProperty['items']> = {
  type: 'object',
  description: 'A span or log from the records table',
  properties: {
    startTimestamp: { type: 'string', description: 'UTC time the span started', nullable: true },
    endTimestamp: { type: 'string', description: 'UTC time the span ended', nullable: true },
    duration: {
      type: 'number',
      description: 'Span duration in seconds. Null for logs.',
      nullable: true,
    },
    level: {
      type: 'string',
      description: 'Severity name, such as info, warn, or error',
      nullable: true,
    },
    message: { type: 'string', description: 'Human-readable message', nullable: true },
    spanName: { type: 'string', description: 'Template label for similar records', nullable: true },
    kind: {
      type: 'string',
      description: 'Record kind: span, log, or span_event',
      nullable: true,
    },
    serviceName: { type: 'string', description: 'Service that emitted the record', nullable: true },
    deploymentEnvironment: {
      type: 'string',
      description: 'Deployment environment of the record',
      nullable: true,
    },
    traceId: { type: 'string', description: 'Trace this record belongs to', nullable: true },
    spanId: { type: 'string', description: 'Identifier of this span', nullable: true },
    parentSpanId: { type: 'string', description: 'Parent span identifier', nullable: true },
    isException: {
      type: 'boolean',
      description: 'Whether an exception was recorded on the span',
      nullable: true,
    },
    exceptionType: {
      type: 'string',
      description: 'Fully qualified exception class name',
      nullable: true,
    },
    exceptionMessage: { type: 'string', description: 'Exception message', nullable: true },
  },
}

export interface LogfireQueryParams extends LogfireBaseParams, LogfireQueryWindowParams {
  sql: string
  timezone?: string
  environment?: string
}

export interface LogfireQueryResponse extends ToolResponse {
  output: {
    rows: Record<string, unknown>[]
    columns: LogfireColumn[]
    rowCount: number
  }
}

export interface LogfireSearchRecordsParams extends LogfireBaseParams, LogfireQueryWindowParams {
  query?: string
  service?: string
  spanName?: string
  minLevel?: LogfireLevel
  environment?: string
  exceptionsOnly?: boolean
}

export interface LogfireGetTraceParams extends LogfireBaseParams, LogfireQueryWindowParams {
  traceId: string
}

/**
 * Shared result of the two tools that project {@link LogfireRecord} rows and
 * echo the SQL they generated.
 */
export interface LogfireRecordsResponse extends ToolResponse {
  output: {
    rows: LogfireRecord[]
    rowCount: number
    sql: string
  }
}

export type LogfireGetTokenInfoParams = LogfireBaseParams

export interface LogfireGetTokenInfoResponse extends ToolResponse {
  output: {
    organizationName: string | null
    projectName: string | null
  }
}

export type LogfireResponse =
  | LogfireQueryResponse
  | LogfireRecordsResponse
  | LogfireGetTokenInfoResponse
