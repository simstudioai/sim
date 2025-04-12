import { ToolResponse } from '../../types'

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
    rows: any[] // Array of query results
    affectedRows: number // Number of affected rows
    metadata: {
      operation: 'select' | 'insert' | 'update' | 'delete' | 'execute'
      query: string
      executionTime: number
      fields?: any[]
      error?: string
      pagination?: {
        page: number
        pageSize: number
        total: number
        totalPages: number
      }
    }
  }
} 