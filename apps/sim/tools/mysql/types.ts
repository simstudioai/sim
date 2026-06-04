import type { ToolResponse } from '@/tools/types'

interface MySQLConnectionConfig {
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
  data: Record<string, unknown>
}

export interface MySQLUpdateParams extends MySQLConnectionConfig {
  table: string
  data: Record<string, unknown>
  where: string
}

export interface MySQLDeleteParams extends MySQLConnectionConfig {
  table: string
  where: string
}

export interface MySQLExecuteParams extends MySQLConnectionConfig {
  query: string
}

interface MySQLBaseResponse extends ToolResponse {
  output: {
    message: string
    rows: unknown[]
    rowCount: number
  }
  error?: string
}

interface MySQLQueryResponse extends MySQLBaseResponse {}
interface MySQLInsertResponse extends MySQLBaseResponse {}
interface MySQLUpdateResponse extends MySQLBaseResponse {}
interface MySQLDeleteResponse extends MySQLBaseResponse {}
interface MySQLExecuteResponse extends MySQLBaseResponse {}
export interface MySQLResponse extends MySQLBaseResponse {}

export interface MySQLIntrospectParams extends MySQLConnectionConfig {}

interface MySQLTableColumn {
  name: string
  type: string
  nullable: boolean
  default: string | null
  isPrimaryKey: boolean
  isForeignKey: boolean
  autoIncrement: boolean
  references?: { table: string; column: string }
}

interface MySQLTableSchema {
  name: string
  database: string
  columns: MySQLTableColumn[]
  primaryKey: string[]
  foreignKeys: Array<{ column: string; referencesTable: string; referencesColumn: string }>
  indexes: Array<{ name: string; columns: string[]; unique: boolean }>
}

export interface MySQLIntrospectResponse extends ToolResponse {
  output: { message: string; tables: MySQLTableSchema[]; databases: string[] }
  error?: string
}
