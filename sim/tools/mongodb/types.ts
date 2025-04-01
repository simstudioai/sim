import { ToolResponse } from '../types'

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
  connection: MongoDBConnectionConfig
  operation: 'find' | 'insert' | 'update' | 'delete' | 'aggregate'
  collection: string
  query?: Record<string, any>
  update?: Record<string, any>
  options?: Record<string, any>
}

export interface MongoDBResponse extends ToolResponse {
  output: {
    result: string // JSON string of operation result
    affectedCount: string // Number of affected documents as string
    metadata: string // Operation metadata as JSON string
  }
} 