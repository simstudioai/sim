// Common types for Airweave tools
import type { ToolResponse } from '@/tools/types'

// Base parameters for Airweave tools
export interface AirweaveBaseParams {
  apiKey: string
  collectionId: string
}

// Search tool types
export interface AirweaveSearchParams extends AirweaveBaseParams {
  query: string
  limit?: number
  offset?: number
  responseType?: 'raw' | 'completion'
  recencyBias?: number
}

export interface AirweaveSearchResult {
  payload: {
    md_content?: string
    source_name?: string
    entity_id?: string
    created_at?: string
    updated_at?: string
    url?: string
    [key: string]: any
  }
  score: number
}

export interface AirweaveSearchResponse extends ToolResponse {
  output: {
    status: string
    results?: AirweaveSearchResult[]
    completion?: string
  }
}

