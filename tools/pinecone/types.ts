import { ToolResponse } from '../types'

export interface PineconeParams {
  apiKey: string
  environment: string
  indexName: string
  operation: 'query' | 'upsert' | 'delete'
  // Query operation
  queryVector?: number[]
  topK?: number
  includeMetadata?: boolean
  includeValues?: boolean
  // Upsert operation
  vectors?: Array<{
    id: string
    values: number[]
    metadata?: Record<string, any>
  }>
  // Delete operation
  ids?: string[]
  deleteAll?: boolean
}

export interface PineconeResponse extends ToolResponse {
  output: {
    matches?: Array<{
      id: string
      score: number
      values?: number[]
      metadata?: Record<string, any>
    }>
    upsertedCount?: number
    deletedCount?: number
  }
}
