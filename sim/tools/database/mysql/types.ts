import { ToolResponse } from '../../types'

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
  ssl?: boolean // Made optional for consistency with PostgreSQL
  // Additional MySQL-specific connection options
  charset?: string
  timezone?: string
  connectTimeout?: number
  compress?: boolean
  maxAllowedPacket?: number
}

export interface MySQLQueryParams {
  connection: MySQLConnectionConfig
  operation: 'select' | 'insert' | 'update' | 'delete' | 'execute'
  query: string
  params?: Array<string | number | boolean | null> // More specific type than any[]
  options?: {
    timeout?: number
    maxRows?: number
    multipleStatements?: boolean
    // Add other specific options as needed
    typeCast?: boolean
    dateStrings?: boolean
    supportBigNumbers?: boolean
    bigNumberStrings?: boolean
  }
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