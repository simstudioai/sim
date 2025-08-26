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
