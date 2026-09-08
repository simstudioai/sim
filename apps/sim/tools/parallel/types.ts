import type { ToolResponse } from '@/tools/types'

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

interface ParallelSearchResult {
  url: string | null
  title: string | null
  publish_date?: string | null
  excerpts: string[]
}

interface ParallelSearchResponse extends ToolResponse {
  output: {
    search_id: string | null
    results: ParallelSearchResult[]
  }
}

export interface ParallelExtractParams {
  urls: string
  objective?: string
  full_content?: boolean
  apiKey: string
}

interface ParallelExtractResult {
  url: string | null
  title?: string | null
  publish_date?: string | null
  excerpts?: string[]
  full_content?: string | null
}

interface ParallelExtractError {
  url: string | null
  error_type: string | null
  http_status_code: number | null
  content: string | null
}

interface ParallelExtractResponse extends ToolResponse {
  output: {
    extract_id: string | null
    results: ParallelExtractResult[]
    errors: ParallelExtractError[]
  }
}

export interface ParallelDeepResearchParams {
  input: string
  output_format?: string
  processor?: string
  include_domains?: string
  exclude_domains?: string
  apiKey: string
}

interface ParallelDeepResearchBasis {
  field: string
  reasoning: string
  citations: {
    url: string
    title: string | null
    excerpts: string[] | null
  }[]
  confidence: string | null
}

interface ParallelDeepResearchResponse extends ToolResponse {
  output: {
    status: string
    run_id: string
    message: string
    content: string | Record<string, unknown>
    basis: ParallelDeepResearchBasis[]
  }
}
