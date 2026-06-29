import type { ToolResponse } from '@/tools/types'

// Base Pinecone params shared across all operations
interface PineconeBaseParams {
  indexHost: string
  namespace: string
  apiKey: string
}

// Response types
interface PineconeMatchResponse {
  id: string
  score: number
  values?: number[]
  metadata?: Record<string, any>
}

export interface PineconeIndexModel {
  name: string
  dimension?: number | null
  metric?: string | null
  host?: string | null
  vectorType?: string | null
  deletionProtection?: string | null
  tags?: Record<string, string> | null
  spec?: Record<string, any> | null
  status?: { ready?: boolean; state?: string } | null
}

export interface PineconeResponse extends ToolResponse {
  output: {
    matches?: PineconeMatchResponse[]
    statusText?: string
    data?: Array<{
      values: number[]
      vector_type: 'dense' | 'sparse'
    }>
    model?: string
    vector_type?: 'dense' | 'sparse'
    namespace?: string | null
    usage?: {
      total_tokens: number
    }
    indexes?: PineconeIndexModel[]
    index?: PineconeIndexModel
    namespaces?: Record<string, { vectorCount: number | null }>
    dimension?: number | null
    indexFullness?: number | null
    totalVectorCount?: number | null
    vectorIds?: string[]
    pagination?: { next?: string } | null
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
interface PineconeUpsertVectorsParams extends PineconeBaseParams {
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
interface PineconeSearchQuery {
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

interface PineconeRerank {
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

interface PineconeSearchResponse {
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

interface PineconeUsage {
  readUnits: number
}

interface PineconeFetchResponse {
  vectors: Record<string, PineconeVector>
  namespace?: string
  usage: PineconeUsage
}

interface PineconeParams {
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

export interface PineconeDeleteVectorsParams {
  apiKey: string
  indexHost: string
  namespace?: string
  ids?: string[] | string
  deleteAll?: boolean | string
  filter?: Record<string, any> | string
}

export interface PineconeUpdateVectorParams {
  apiKey: string
  indexHost: string
  id: string
  namespace?: string
  values?: number[] | string
  sparseValues?: { indices: number[]; values: number[] } | string
  setMetadata?: Record<string, any> | string
}

export interface PineconeDescribeIndexStatsParams {
  apiKey: string
  indexHost: string
  filter?: Record<string, any> | string
}

export interface PineconeListIndexesParams {
  apiKey: string
}

export interface PineconeDescribeIndexParams {
  apiKey: string
  indexName: string
}

export interface PineconeListVectorIdsParams {
  apiKey: string
  indexHost: string
  namespace: string
  prefix?: string
  limit?: number | string
  paginationToken?: string
}
