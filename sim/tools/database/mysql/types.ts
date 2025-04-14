import { ToolResponse } from '../../types'
import { SQLOperation, SQLParam } from '../postgresql/types'

// Field metadata interface for type safety
export interface MySQLFieldMetadata {
  name: string
  type: number
  columnLength: number
  tableId: number
  flags: number
  decimals: number
  charsetNr: number
  // Additional MySQL-specific field properties
  typeName?: string
  schema?: string
  table?: string
  orgName?: string
  orgTable?: string
}

export interface MySQLConnectionConfig {
  host: string
  port: number
  user: string
  password: string
  database: string
  ssl: boolean
  // Additional MySQL-specific connection options
  charset?: string
  timezone?: string
  connectTimeout?: number
  compress?: boolean
  maxAllowedPacket?: number
  multipleStatements?: boolean
  dateStrings?: boolean
  debug?: boolean
  trace?: boolean
  localInfile?: boolean
}

export interface MySQLQueryOptions {
  // Common options shared with PostgreSQL
  timeout?: number
  maxRows?: number
  // MySQL-specific options
  typeCast?: boolean
  dateStrings?: boolean
  supportBigNumbers?: boolean
  bigNumberStrings?: boolean
  nestTables?: boolean | string
  decimalNumbers?: boolean
  // Query execution options
  sql?: string
  values?: SQLParam[]
  // Transaction options
  isolationLevel?: 'READ UNCOMMITTED' | 'READ COMMITTED' | 'REPEATABLE READ' | 'SERIALIZABLE'
}

export interface MySQLQueryParams {
  connection: MySQLConnectionConfig
  operation: SQLOperation
  query: string
  params?: SQLParam[]
  options?: MySQLQueryOptions
}

export interface MySQLResponse extends ToolResponse {
  output: {
    rows: Record<string, unknown>[] // More specific than any[]
    affectedRows: number
    fields: MySQLFieldMetadata[]
    executionTime: number
    // Additional MySQL-specific response properties
    insertId?: number
    changedRows?: number
    warningCount?: number
    info?: string
  }
} 