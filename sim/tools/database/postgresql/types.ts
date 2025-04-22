import { ToolResponse } from '../../types'

// Common SQL operation type for both MySQL and PostgreSQL
export type SQLOperation = 'select' | 'insert' | 'update' | 'delete' | 'execute'

// Common SQL parameter type for both MySQL and PostgreSQL
export type SQLParam = string | number | boolean | null | Date | Buffer

// Field metadata interface for type safety
export interface PostgreSQLFieldMetadata {
  name: string
  tableID: number
  columnID: number
  dataTypeID: number
  dataTypeSize: number
  dataTypeModifier: number
  format: string
  // Additional PostgreSQL-specific field properties
  schema?: string
  table?: string
  typeName?: string
}

export interface PostgreSQLConnectionConfig {
  host: string
  port: number
  user: string
  password: string
  database: string
  ssl: boolean
  schema?: string // PostgreSQL-specific option
  // Additional PostgreSQL-specific connection options
  applicationName?: string
  keepAlive?: boolean
  keepAliveInitialDelayMillis?: number
  statement_timeout?: number
  query_timeout?: number
  idle_in_transaction_session_timeout?: number
}

export interface PostgreSQLQueryOptions {
  // Common options shared with MySQL
  timeout?: number
  maxRows?: number
  // PostgreSQL-specific options
  fetchSize?: number
  readOnly?: boolean
  portal?: string
  binary?: boolean
  parallel?: boolean
  // Query execution options
  rowMode?: 'array' | 'object'
  types?: Record<string, any>
  // Transaction options
  isolationLevel?: 'READ COMMITTED' | 'REPEATABLE READ' | 'SERIALIZABLE'
}

export interface PostgreSQLQueryParams {
  connection: PostgreSQLConnectionConfig
  operation: SQLOperation
  query: string
  params?: SQLParam[]
  options?: PostgreSQLQueryOptions
}

export interface PostgreSQLResponse extends ToolResponse {
  output: {
    rows: Record<string, unknown>[] // More specific than any[]
    rowCount: number
    fields: PostgreSQLFieldMetadata[]
    executionTime: number // Made required for consistency
    // Additional PostgreSQL-specific response properties
    command?: string
    oid?: number
    notices?: string[]
  }
} 