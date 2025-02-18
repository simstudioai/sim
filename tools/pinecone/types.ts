import { ToolResponse } from '../types'

// Base Pinecone params shared across all operations
export interface PineconeBaseParams {
  apiKey: string
  environment: string
  indexName: string
}

// Response types
export interface PineconeMatchResponse {
  id: string
  score: number
  values?: number[]
  metadata?: Record<string, any>
}

export interface PineconeResponse extends ToolResponse {
  output: {
    matches?: PineconeMatchResponse[]
    upsertedCount?: number
    deletedCount?: number
    data?: Array<{
      values: number[]
      vector_type: 'dense' | 'sparse'
    }>
    model?: string
    vector_type?: 'dense' | 'sparse'
    usage?: {
      total_tokens: number
    }
  }
}

// Generate Embeddings
export interface PineconeGenerateEmbeddingsParams {
  apiKey: string
  model: string
  inputs: { text: string }[]
  parameters?: {
    input_type?: 'passage'
    truncate?: 'END'
  }
}

// Upsert Text
export interface PineconeUpsertTextParams extends PineconeBaseParams {
  namespace?: string
  records: {
    _id: string
    text: string
    metadata?: Record<string, any>
  }[]
}

// Upsert Vectors
export interface PineconeUpsertVectorsParams extends PineconeBaseParams {
  namespace?: string
  vectors: {
    id: string
    values: number[]
    metadata?: Record<string, any>
    sparseValues?: {
      indices: number[]
      values: number[]
    }
  }[]
}

// Search Text
export interface PineconeSearchTextParams extends PineconeBaseParams {
  namespace?: string
  query: {
    inputs: string
    top_k: number
    filter?: Record<string, any>
  }
  fields?: string[]
  rerank?: {
    model: string
    rank_fields: string[]
    top_n?: number
    parameters?: Record<string, any>
    query?: string
  }
}

// Fetch Vectors
export interface PineconeFetchParams extends PineconeBaseParams {
  ids: string[]
  namespace?: string
}

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
