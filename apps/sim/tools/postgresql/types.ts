import type { ToolResponse } from '@/tools/types'

export interface PostgresConnectionConfig {
  host: string
  port: number
  database: string
  username: string
  password: string
  ssl: 'disabled' | 'required' | 'preferred'
}

export interface PostgresQueryParams extends PostgresConnectionConfig {
  query: string
}

export interface PostgresInsertParams extends PostgresConnectionConfig {
  table: string
  data: Record<string, unknown>
}

export interface PostgresUpdateParams extends PostgresConnectionConfig {
  table: string
  data: Record<string, unknown>
  where: string
}

export interface PostgresDeleteParams extends PostgresConnectionConfig {
  table: string
  where: string
}

export interface PostgresExecuteParams extends PostgresConnectionConfig {
  query: string
}

export interface PostgresBaseResponse extends ToolResponse {
  output: {
    message: string
    rows: unknown[]
    rowCount: number
  }
  error?: string
}

export interface PostgresQueryResponse extends PostgresBaseResponse {}
export interface PostgresInsertResponse extends PostgresBaseResponse {}
export interface PostgresUpdateResponse extends PostgresBaseResponse {}
export interface PostgresDeleteResponse extends PostgresBaseResponse {}
export interface PostgresExecuteResponse extends PostgresBaseResponse {}
export interface PostgresResponse extends PostgresBaseResponse {}
