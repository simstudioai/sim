import type { ToolResponse } from '@/tools/types'

export interface MongoDBConnectionConfig {
  host: string
  port: number
  database: string
  username?: string
  password?: string
  authSource?: string
  ssl?: 'disabled' | 'required' | 'preferred'
}

export interface MongoDBQueryParams extends MongoDBConnectionConfig {
  collection: string
  query?: string
  limit?: number
  sort?: string
}

export interface MongoDBInsertParams extends MongoDBConnectionConfig {
  collection: string
  documents: unknown[]
}

export interface MongoDBUpdateParams extends MongoDBConnectionConfig {
  collection: string
  filter: string
  update: string
  upsert?: boolean
  multi?: boolean
}

export interface MongoDBDeleteParams extends MongoDBConnectionConfig {
  collection: string
  filter: string
  multi?: boolean
}

export interface MongoDBExecuteParams extends MongoDBConnectionConfig {
  collection: string
  pipeline: string
}

export interface MongoDBBaseResponse extends ToolResponse {
  output: {
    message: string
    documents?: unknown[]
    documentCount: number
    insertedId?: string
    insertedIds?: string[]
    modifiedCount?: number
    deletedCount?: number
    matchedCount?: number
  }
  error?: string
}

export interface MongoDBQueryResponse extends MongoDBBaseResponse {}
export interface MongoDBInsertResponse extends MongoDBBaseResponse {}
export interface MongoDBUpdateResponse extends MongoDBBaseResponse {}
export interface MongoDBDeleteResponse extends MongoDBBaseResponse {}
export interface MongoDBExecuteResponse extends MongoDBBaseResponse {}
export interface MongoDBResponse extends MongoDBBaseResponse {}
