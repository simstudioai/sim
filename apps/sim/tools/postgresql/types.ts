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

export interface PostgresIntrospectParams extends PostgresConnectionConfig {
  schema?: string
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

export interface TableColumn {
  name: string
  type: string
  nullable: boolean
  default: string | null
  isPrimaryKey: boolean
  isForeignKey: boolean
  references?: {
    table: string
    column: string
  }
}

export interface TableSchema {
  name: string
  schema: string
  columns: TableColumn[]
  primaryKey: string[]
  foreignKeys: Array<{
    column: string
    referencesTable: string
    referencesColumn: string
  }>
  indexes: Array<{
    name: string
    columns: string[]
    unique: boolean
  }>
}

export interface PostgresIntrospectResponse extends ToolResponse {
  output: {
    message: string
    tables: TableSchema[]
    schemas: string[]
  }
  error?: string
}

export interface PostgresResponse extends PostgresBaseResponse {}
