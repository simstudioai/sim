import { ToolResponse } from '../types'

export interface MySQLConnectionConfig {
  host: string
  port: number
  username: string
  password: string
  database: string
  ssl: boolean
  timezone?: string
}

export interface MySQLQueryParams {
  connection: MySQLConnectionConfig
  operation: 'select' | 'insert' | 'update' | 'delete' | 'execute'
  query: string
  params?: any[]
  options?: {
    timeout?: number
    namedPlaceholders?: boolean
    nestTables?: boolean
  }
}

export interface MySQLResponse extends ToolResponse {
  output: {
    rows: string // JSON string of query results
    affectedRows: string // JSON string of affected rows
    metadata: string // JSON string of metadata
  }
} 