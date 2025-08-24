import type { ToolResponse } from '@/tools/types'

export interface MySQLConnectionConfig {
  host: string
  port: number
  database: string
  username: string
  password: string
  ssl: 'disabled' | 'required' | 'preferred'
}

export interface MySQLQueryParams extends MySQLConnectionConfig {
  query: string
}

export interface MySQLInsertParams extends MySQLConnectionConfig {
  table: string
  data: Record<string, any>
}

export interface MySQLUpdateParams extends MySQLConnectionConfig {
  table: string
  data: Record<string, any>
  where: string
}

export interface MySQLDeleteParams extends MySQLConnectionConfig {
  table: string
  where: string
}

export interface MySQLExecuteParams extends MySQLConnectionConfig {
  query: string
}

export interface MySQLBaseResponse extends ToolResponse {
  output: {
    message: string
    rows: any[]
    rowCount: number
  }
  error?: string
}

export interface MySQLQueryResponse extends MySQLBaseResponse {}
export interface MySQLInsertResponse extends MySQLBaseResponse {}
export interface MySQLUpdateResponse extends MySQLBaseResponse {}
export interface MySQLDeleteResponse extends MySQLBaseResponse {}
export interface MySQLExecuteResponse extends MySQLBaseResponse {}
export interface MySQLResponse extends MySQLBaseResponse {}
