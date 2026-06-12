import type { ToolResponse } from '@/tools/types'

/**
 * Base parameters for Tinybird API tools
 */
interface TinybirdBaseParams {
  token: string
}

/**
 * Parameters for sending events to Tinybird
 */
export interface TinybirdEventsParams extends TinybirdBaseParams {
  base_url: string
  datasource: string
  data: string
  wait?: boolean
  format?: 'ndjson' | 'json'
  compression?: 'none' | 'gzip'
}

/**
 * Response from sending events to Tinybird
 */
export interface TinybirdEventsResponse extends ToolResponse {
  output: {
    successful_rows: number
    quarantined_rows: number
  }
}

/**
 * Parameters for querying Tinybird
 */
export interface TinybirdQueryParams extends TinybirdBaseParams {
  base_url: string
  query: string
  pipeline?: string
}

/**
 * Response from querying Tinybird
 */
export interface TinybirdQueryResponse extends ToolResponse {
  output: {
    data: unknown[] | string
    meta?: Array<{ name: string; type: string }>
    rows?: number
    rows_before_limit_at_least?: number
    statistics?: TinybirdQueryStatistics
  }
}

/**
 * Query execution statistics returned by the Query API and Pipe endpoints
 */
interface TinybirdQueryStatistics {
  elapsed: number
  rows_read: number
  bytes_read: number
}

/**
 * Parameters for calling a published Pipe API Endpoint by name
 */
export interface TinybirdQueryPipeParams extends TinybirdBaseParams {
  base_url: string
  pipe: string
  parameters?: Record<string, unknown> | string
  q?: string
}

/**
 * Response from calling a published Pipe API Endpoint (`.json` format)
 */
export interface TinybirdQueryPipeResponse extends ToolResponse {
  output: {
    data: unknown[]
    meta?: Array<{ name: string; type: string }>
    rows?: number
    rows_before_limit_at_least?: number
    statistics?: TinybirdQueryStatistics
  }
}

/**
 * Parameters for appending data to a Data Source from a URL
 */
export interface TinybirdAppendDatasourceParams extends TinybirdBaseParams {
  base_url: string
  datasource: string
  url: string
  format?: 'csv' | 'ndjson' | 'parquet'
}

/**
 * Response from an append-from-URL import job
 */
export interface TinybirdAppendDatasourceResponse extends ToolResponse {
  output: {
    id: string | null
    import_id: string | null
    job_id: string | null
    job_url: string | null
    status: string | null
    job: Record<string, unknown> | null
    datasource: Record<string, unknown> | null
  }
}

/**
 * Parameters for truncating (deleting all rows from) a Data Source
 */
export interface TinybirdTruncateDatasourceParams extends TinybirdBaseParams {
  base_url: string
  datasource: string
}

/**
 * Response from truncating a Data Source
 */
export interface TinybirdTruncateDatasourceResponse extends ToolResponse {
  output: {
    truncated: boolean
    result: Record<string, unknown> | null
  }
}

/**
 * Parameters for deleting rows from a Data Source by condition
 */
export interface TinybirdDeleteDatasourceRowsParams extends TinybirdBaseParams {
  base_url: string
  datasource: string
  delete_condition: string
  dry_run?: boolean
}

/**
 * Response from a delete-by-condition job
 */
export interface TinybirdDeleteDatasourceRowsResponse extends ToolResponse {
  output: {
    id: string | null
    job_id: string | null
    delete_id: string | null
    job_url: string | null
    status: string | null
    job: Record<string, unknown> | null
  }
}

/**
 * Union type for all possible Tinybird responses
 */
export type TinybirdResponse =
  | TinybirdEventsResponse
  | TinybirdQueryResponse
  | TinybirdQueryPipeResponse
  | TinybirdAppendDatasourceResponse
  | TinybirdTruncateDatasourceResponse
  | TinybirdDeleteDatasourceRowsResponse
