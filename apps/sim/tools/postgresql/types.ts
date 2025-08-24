import type { ToolResponse } from '@/tools/types'

export interface PostgresConnectionConfig {
  host: string
  port: number
  database: string
  username: string
  password: string
  ssl: 'disable' | 'require' | 'prefer'
}

export interface PostgresQueryParams extends PostgresConnectionConfig {
  query: string
}

export interface PostgresInsertParams extends PostgresConnectionConfig {
  table: string
  data: Record<string, any>
}

export interface PostgresUpdateParams extends PostgresConnectionConfig {
  table: string
  data: Record<string, any>
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
    rows: any[]
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
