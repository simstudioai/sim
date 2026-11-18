import type { ToolResponse } from '@/tools/types'

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
      citation_tokens?: number
      num_search_queries?: number
      reasoning_tokens?: number
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

interface PerplexitySearchResult {
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

export interface PerplexityAgentParams {
  content: string
  model: string
  systemPrompt?: string
  web_search?: boolean
  fetch_url?: boolean
  max_steps?: number
  max_tokens?: number
  apiKey: string
}

interface PerplexityAgentSource {
  title: string
  url: string
  snippet: string
  date: string | null
  last_updated: string | null
}

interface PerplexityAgentCost {
  total_cost?: number
}

export interface PerplexityAgentResponse extends ToolResponse {
  output: {
    content: string
    model: string
    status: string
    sources: PerplexityAgentSource[]
    usage: {
      input_tokens: number
      output_tokens: number
      total_tokens: number
    }
    __cost?: PerplexityAgentCost
  }
}
