// Common types for Exa AI tools
import type { ToolResponse } from '@/tools/types'

// Common parameters for all Exa AI tools
export interface ExaBaseParams {
  apiKey: string
}

// Search tool types
export interface ExaSearchParams extends ExaBaseParams {
  query: string
  numResults?: number
  useAutoprompt?: boolean
  type?: 'auto' | 'neural' | 'keyword' | 'fast'
  // Domain filtering
  includeDomains?: string
  excludeDomains?: string
  // Category filtering
  category?:
    | 'company'
    | 'research_paper'
    | 'news_article'
    | 'pdf'
    | 'github'
    | 'tweet'
    | 'movie'
    | 'song'
    | 'personal_site'
  // Content options
  text?: boolean | { maxCharacters?: number }
  highlights?: boolean | { query?: string; numSentences?: number; highlightsPerUrl?: number }
  summary?: boolean | { query?: string }
  // Live crawl mode
  livecrawl?: 'always' | 'fallback' | 'never'
}

export interface ExaSearchResult {
  title: string
  url: string
  publishedDate?: string
  author?: string
  summary?: string
  favicon?: string
  image?: string
  text?: string
  highlights?: string[]
  score: number
}

export interface ExaSearchResponse extends ToolResponse {
  output: {
    results: ExaSearchResult[]
  }
}

// Get Contents tool types
export interface ExaGetContentsParams extends ExaBaseParams {
  urls: string
  text?: boolean | { maxCharacters?: number }
  summaryQuery?: string
  // Subpages crawling
  subpages?: number
  subpageTarget?: string
  // Content options
  highlights?: boolean | { query?: string; numSentences?: number; highlightsPerUrl?: number }
  // Live crawl mode
  livecrawl?: 'always' | 'fallback' | 'never'
}

export interface ExaGetContentsResult {
  url: string
  title: string
  text?: string
  summary?: string
  highlights?: string[]
}

export interface ExaGetContentsResponse extends ToolResponse {
  output: {
    results: ExaGetContentsResult[]
  }
}

// Find Similar Links tool types
export interface ExaFindSimilarLinksParams extends ExaBaseParams {
  url: string
  numResults?: number
  text?: boolean | { maxCharacters?: number }
  // Domain filtering
  includeDomains?: string
  excludeDomains?: string
  excludeSourceDomain?: boolean
  // Category filtering
  category?:
    | 'company'
    | 'research_paper'
    | 'news_article'
    | 'pdf'
    | 'github'
    | 'tweet'
    | 'movie'
    | 'song'
    | 'personal_site'
  // Content options
  highlights?: boolean | { query?: string; numSentences?: number; highlightsPerUrl?: number }
  summary?: boolean | { query?: string }
  // Live crawl mode
  livecrawl?: 'always' | 'fallback' | 'never'
}

export interface ExaSimilarLink {
  title: string
  url: string
  text?: string
  summary?: string
  highlights?: string[]
  score: number
}

export interface ExaFindSimilarLinksResponse extends ToolResponse {
  output: {
    similarLinks: ExaSimilarLink[]
  }
}

// Answer tool types
export interface ExaAnswerParams extends ExaBaseParams {
  query: string
  text?: boolean
}

export interface ExaAnswerResponse extends ToolResponse {
  output: {
    answer: string
    citations: {
      title: string
      url: string
      text: string
    }[]
  }
}

// Research tool types
export interface ExaResearchParams extends ExaBaseParams {
  query: string
  model?: 'exa-research-fast' | 'exa-research' | 'exa-research-pro'
}

export interface ExaResearchResponse extends ToolResponse {
  output: {
    taskId?: string
    research: {
      title: string
      url: string
      summary: string
      text?: string
      publishedDate?: string
      author?: string
      score: number
    }[]
  }
}

export type ExaResponse =
  | ExaSearchResponse
  | ExaGetContentsResponse
  | ExaFindSimilarLinksResponse
  | ExaAnswerResponse
  | ExaResearchResponse
