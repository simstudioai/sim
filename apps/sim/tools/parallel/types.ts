export interface ParallelSearchParams {
  objective: string
  search_queries: string[]
  processor?: string
  max_results?: number
  max_chars_per_result?: number
  apiKey: string
}

export interface ParallelSearchResult {
  url: string
  title: string
  excerpts: string[]
}

export interface ParallelSearchResponse {
  results: ParallelSearchResult[]
}

export interface ParallelExtractParams {
  urls: string
  objective: string
  excerpts: boolean
  full_content: boolean
  apiKey: string
}

export interface ParallelExtractResult {
  url: string
  title: string
  content?: string
  excerpts?: string[]
}

export interface ParallelExtractResponse {
  results: ParallelExtractResult[]
}

export interface ParallelDeepResearchParams {
  input: string
  processor?: string
  include_domains?: string
  exclude_domains?: string
  apiKey: string
}

export interface ParallelDeepResearchBasis {
  url: string
  title: string
  excerpt: string
  confidence?: number
}

export interface ParallelDeepResearchResponse {
  status: string
  run_id: string
  message?: string
  content?: Record<string, unknown>
  basis?: ParallelDeepResearchBasis[]
  metadata?: Record<string, unknown>
}
