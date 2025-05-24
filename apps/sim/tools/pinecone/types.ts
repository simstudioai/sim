import { ToolResponse } from '../types'

// Base Pinecone params shared across all operations
export interface PineconeBaseParams {
  indexHost: string
  namespace: string
  apiKey: string
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
export interface PineconeUpsertTextRecord {
  _id: string
  chunk_text: string
  category?: string
  [key: string]: any
}

export interface PineconeUpsertTextParams extends PineconeBaseParams {
  records: PineconeUpsertTextRecord | PineconeUpsertTextRecord[]
}

// Upsert Vectors
export interface PineconeUpsertVectorsParams extends PineconeBaseParams {
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
export interface PineconeSearchQuery {
  inputs?: { text: string }
  vector?: {
    values: number[]
    sparse_values?: number[]
    sparse_indices?: number[]
  }
  id?: string
  top_k: number
  filter?: Record<string, any>
}

export interface PineconeRerank {
  model: string
  rank_fields: string[]
  top_n?: number
  parameters?: Record<string, any>
  query?: { text: string }
}

export interface PineconeSearchTextParams extends PineconeBaseParams {
  searchQuery: string
  topK?: string
  fields?: string[] | string
  filter?: Record<string, any> | string
  rerank?: PineconeRerank | string
}

export interface PineconeSearchHit {
  _id: string
  _score: number
  fields?: Record<string, any>
}

export interface PineconeSearchResponse {
  result: {
    hits: PineconeSearchHit[]
  }
  usage: {
    read_units: number
    embed_total_tokens?: number
    rerank_units?: number
  }
}

// Fetch Vectors
export interface PineconeFetchParams extends PineconeBaseParams {
  ids: string[]
}

export interface PineconeVector {
  id: string
  values: number[]
  metadata?: Record<string, any>
}

export interface PineconeUsage {
  readUnits: number
}

export interface PineconeFetchResponse {
  vectors: Record<string, PineconeVector>
  namespace?: string
  usage: PineconeUsage
}

export interface PineconeParams {
  apiKey: string
  indexHost: string
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
}

// Search Vector
export interface PineconeSearchVectorParams extends PineconeBaseParams {
  vector: number[] | string
  topK?: number | string
  filter?: Record<string, any> | string
  includeValues?: boolean
  includeMetadata?: boolean
}
