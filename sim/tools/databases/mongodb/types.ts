import { ToolResponse } from '../../types'

export interface MongoDBConnectionConfig {
  host: string
  port: number
  username: string
  password: string
  database: string
  ssl?: boolean
  authSource?: string
}

export interface MongoDBQueryParams {
  // Connection parameters (can be either at root or in connection object)
  host?: string
  port?: string | number
  username?: string
  password?: string
  database?: string
  ssl?: string | boolean
  connection?: MongoDBConnectionConfig

  // Operation parameters
  operation: 'find' | 'insert' | 'update' | 'delete' | 'aggregate'
  collection: string
  query?: string | Record<string, any>
  projection?: string | Record<string, any>
  document?: string | Record<string, any>
  update?: string | Record<string, any>
  pipeline?: string | Record<string, any>[]
  options?: string | Record<string, any>
}

export interface MongoDBResponse extends ToolResponse {
  output: {
    result: string // JSON string of operation result
    affectedCount: string // Number of affected documents as string
    metadata: string // Operation metadata as JSON string
  }
} 