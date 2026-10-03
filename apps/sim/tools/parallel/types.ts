export interface ParallelSearchParams {
  search_queries: string[] | string
  objective?: string
  mode?: string
  max_results?: number
  max_chars_per_result?: number
  include_domains?: string
  exclude_domains?: string
  apiKey: string
}

export interface ParallelExtractParams {
  urls: string
  objective?: string
  full_content?: boolean
  apiKey: string
}

export interface ParallelDeepResearchParams {
  input: string
  output_format?: string
  processor?: string
  include_domains?: string
  exclude_domains?: string
  apiKey: string
}
