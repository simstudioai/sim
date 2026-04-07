import type { ToolResponse } from '@/tools/types'

export interface ParallelSearchParams {
  objective: string
  search_queries?: string[] | string
  mode?: string
  max_results?: number
  max_chars_per_result?: number
  include_domains?: string
  exclude_domains?: string
  apiKey: string
}

export interface ParallelSearchResult {
  url: string | null
  title: string | null
  publish_date?: string | null
  excerpts: string[]
}

export interface ParallelSearchResponse extends ToolResponse {
  output: {
    search_id: string | null
    results: ParallelSearchResult[]
  }
}

export interface ParallelExtractParams {
  urls: string
  objective?: string
  excerpts?: boolean
  full_content?: boolean
  apiKey: string
}

export interface ParallelExtractResult {
  url: string | null
  title?: string | null
  publish_date?: string | null
  excerpts?: string[]
  full_content?: string | null
}

export interface ParallelExtractResponse extends ToolResponse {
  output: {
    extract_id: string | null
    results: ParallelExtractResult[]
  }
}

export interface ParallelDeepResearchParams {
  input: string
  processor?: string
  include_domains?: string
  exclude_domains?: string
  apiKey: string
}

export interface ParallelDeepResearchBasis {
  field: string
  reasoning: string
  citations: {
    url: string
    title: string
    excerpts: string[]
  }[]
  confidence: string
}

export interface ParallelDeepResearchResponse extends ToolResponse {
  output: {
    status: string
    run_id: string
    message: string
    content: Record<string, unknown>
    basis: ParallelDeepResearchBasis[]
  }
}
