import { ToolResponse } from '../types'

export interface PostgreSQLConnectionConfig {
  host: string
  port: number
  username: string
  password: string
  database: string
  ssl?: boolean
  schema?: string
}

export interface PostgreSQLQueryParams {
  connection: PostgreSQLConnectionConfig
  operation: 'select' | 'insert' | 'update' | 'delete' | 'execute'
  query: string
  params?: any[]
  options?: Record<string, any>
}

export interface PostgreSQLResponse extends ToolResponse {
  output: {
    rows: string // JSON string of query results
    affectedRows: string // Number of affected rows as string
    metadata: string // Operation metadata as JSON string
  }
} 