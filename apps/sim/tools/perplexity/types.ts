import type { ToolResponse } from '@/tools/types'

export interface PerplexityMessage {
  role: string
  content: string
}

export interface PerplexityChatParams {
  systemPrompt?: string
  content: string
  model: string
  max_tokens?: number
  temperature?: number
  apiKey: string
}

export interface PerplexityChatResponse extends ToolResponse {
  output: {
    content: string
    model: string
    usage: {
      prompt_tokens: number
      completion_tokens: number
      total_tokens: number
    }
  }
}

export interface PerplexitySearchParams {
  query: string | string[]
  max_results?: number
  search_domain_filter?: string[]
  max_tokens_per_page?: number
  country?: string
  search_recency_filter?: 'hour' | 'day' | 'week' | 'month' | 'year'
  search_after_date?: string
  search_before_date?: string
  apiKey: string
}

export interface PerplexitySearchResult {
  title: string
  url: string
  snippet: string
  date: string
  last_updated: string
}

export interface PerplexitySearchResponse extends ToolResponse {
  output: {
    results: PerplexitySearchResult[]
  }
}
