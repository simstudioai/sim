import { ToolResponse } from '../../types'

// Field metadata interface for type safety
export interface PostgreSQLFieldMetadata {
  name: string
  tableID: number
  columnID: number
  dataTypeID: number
  dataTypeSize: number
  dataTypeModifier: number
  format: string
}

export interface PostgreSQLConnectionConfig {
  host: string
  port: number
  user: string // Changed from username to user for consistency with MySQL
  password: string
  database: string
  ssl: boolean // Changed from optional to required for consistency with MySQL
  schema?: string // PostgreSQL-specific option
}

export interface PostgreSQLQueryParams {
  connection: PostgreSQLConnectionConfig
  operation: 'select' | 'insert' | 'update' | 'delete' | 'execute' // Aligned with MySQL operations
  query: string
  params?: Array<string | number | boolean | null> // More specific type than any[]
  options?: {
    timeout?: number
    maxRows?: number
    fetchSize?: number
    // Add other specific options as needed
  }
}

export interface PostgreSQLResponse extends ToolResponse {
  output: {
    rows: Record<string, unknown>[] // More specific than any[]
    rowCount: number
    fields: PostgreSQLFieldMetadata[]
    executionTime?: number // Added for consistency with MySQL
  }
} 