import type { ToolResponse } from '@/tools/types'

export interface QdrantBaseParams {
  url: string
  apiKey?: string
  collection: string
}

export interface QdrantVector {
  id: string
  vector: number[]
  payload?: Record<string, any>
}

export interface QdrantUpsertParams extends QdrantBaseParams {
  points: QdrantVector[]
}

export interface QdrantSearchParams extends QdrantBaseParams {
  vector: number[]
  limit?: number
  filter?: Record<string, any>
  search_return_data?: string
  with_payload?: boolean
  with_vector?: boolean
}

export interface QdrantFetchParams extends QdrantBaseParams {
  ids: string[]
  fetch_return_data?: string
  with_payload?: boolean
  with_vector?: boolean
}

export interface QdrantResponse extends ToolResponse {
  output: {
    result?: any
    status?: string
    matches?: Array<{
      id: string
      score: number
      payload?: Record<string, any>
      vector?: number[]
    }>
    upsertedCount?: number
    data?: any
  }
}
