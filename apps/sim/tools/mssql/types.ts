import type { ToolResponse } from '@/tools/types'

/**
 * Connection fields accepted by every Microsoft SQL Server tool.
 * `encrypt` and `trustServerCertificate` map onto the Tedious driver's
 * `options.encrypt` / `options.trustServerCertificate` booleans, and
 * `instanceName` onto `options.instanceName`.
 * @see https://github.com/tediousjs/node-mssql#tedious
 */
export interface MSSQLConnectionConfig {
  host: string
  port: number
  database: string
  username: string
  password: string
  encrypt: 'enabled' | 'disabled'
  trustServerCertificate: 'enabled' | 'disabled'
  instanceName?: string
  connectionTimeout?: number
}

export interface MSSQLQueryParams extends MSSQLConnectionConfig {
  query: string
}

export interface MSSQLExecuteParams extends MSSQLConnectionConfig {
  query: string
}

export interface MSSQLInsertParams extends MSSQLConnectionConfig {
  table: string
  data: Record<string, unknown>
}

export interface MSSQLUpdateParams extends MSSQLConnectionConfig {
  table: string
  data: Record<string, unknown>
  where: string
}

export interface MSSQLDeleteParams extends MSSQLConnectionConfig {
  table: string
  where: string
}

export interface MSSQLIntrospectParams extends MSSQLConnectionConfig {
  schema?: string
}

interface MSSQLBaseResponse extends ToolResponse {
  output: {
    message: string
    rows: unknown[]
    rowCount: number
  }
  error?: string
}

export interface MSSQLQueryResponse extends MSSQLBaseResponse {}
export interface MSSQLExecuteResponse extends MSSQLBaseResponse {}
export interface MSSQLInsertResponse extends MSSQLBaseResponse {}
export interface MSSQLUpdateResponse extends MSSQLBaseResponse {}
export interface MSSQLDeleteResponse extends MSSQLBaseResponse {}
export interface MSSQLResponse extends MSSQLBaseResponse {}

interface MSSQLTableColumn {
  name: string
  type: string
  nullable: boolean
  default: string | null
  isPrimaryKey: boolean
  isForeignKey: boolean
  references?: { table: string; column: string }
}

interface MSSQLTableSchema {
  name: string
  schema: string
  columns: MSSQLTableColumn[]
  primaryKey: string[]
  foreignKeys: Array<{ column: string; referencesTable: string; referencesColumn: string }>
  indexes: Array<{ name: string; columns: string[]; unique: boolean }>
}

export interface MSSQLIntrospectResponse extends ToolResponse {
  output: { message: string; tables: MSSQLTableSchema[]; schemas: string[] }
  error?: string
}
