import type { ToolResponse } from '@/tools/types'

/**
 * Base parameters for Tinybird API tools
 */
export interface TinybirdBaseParams {
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
    rows?: number
    statistics?: {
      elapsed: number
      rows_read: number
      bytes_read: number
    }
  }
}

/**
 * Union type for all possible Tinybird responses
 */
export type TinybirdResponse = TinybirdEventsResponse | TinybirdQueryResponse
