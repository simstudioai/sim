import type { ToolResponse } from '@/tools/types'

export interface WebzSearchParams {
  apiKey: string
  query: string
  k?: number
  publishedAfter?: string
  publishedBefore?: string
  language?: string[]
  country?: string[]
  source?: string[]
  sentiment?: string[]
  category?: string[]
  scoreGte?: number
  scoreLte?: number
}

export interface WebzSearchResponse extends ToolResponse {
  output: {
    query: string
    total_results: number
    requests_left: number | null
    credits_used: number | null
    results: Array<{
      score: number
      article: {
        article_id: string | null
        url: string | null
        title: string | null
        published_at: string | null
        summary: string | null
        main_image: string | null
      }
      chunk: {
        chunk_id: string | null
        chunk_index: number | null
        text: string | null
      }
      metadata: {
        language: string | null
        country: string | null
        category: string[]
        sentiment: string | null
        domain: string | null
        site_type: string | null
        topic: string[]
        person: string[]
        organization: string[]
        location: string[]
        ticker: string[]
        source_type: string | null
        political_bias: string | null
        trust_category: string | null
        domain_rank: number | null
      }
    }>
  }
}
