import { ToolResponse } from '../../types'

export interface MySQLConnectionConfig {
  host: string
  port: number
  user: string
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

export interface MySQLMetadata {
  operation: 'select' | 'insert' | 'update' | 'delete' | 'execute'
  query: string
  executionTime: number
  fields: Array<{
    name: string
    type: number
    length: number
  }>
}

export interface MySQLResponse extends ToolResponse {
  output: {
    rows: any[]
    affectedRows: number
    metadata: MySQLMetadata
  }
} 