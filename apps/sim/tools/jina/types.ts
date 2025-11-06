import type { ToolResponse } from '@/tools/types'

export interface ReadUrlParams {
  url: string
  // Existing params (backward compatible)
  useReaderLMv2?: boolean
  gatherLinks?: boolean
  jsonResponse?: boolean
  apiKey?: string
  // Content extraction params
  withImagesummary?: boolean
  retainImages?: 'none' | 'all'
  returnFormat?: 'markdown' | 'html' | 'text' | 'screenshot' | 'pageshot'
  withIframe?: boolean
  withShadowDom?: boolean
  // Performance & caching
  noCache?: boolean
  // Advanced options
  withGeneratedAlt?: boolean
  robotsTxt?: string
  dnt?: boolean
  noGfm?: boolean
}

export interface ReadUrlResponse extends ToolResponse {
  output: {
    content: string
    links?: string[]
    images?: string[]
  }
}

export interface SearchParams {
  q: string
  apiKey?: string
  // Pagination
  num?: number
  // Site restriction
  site?: string | string[]
  // Content options
  withFavicon?: boolean
  withImagesummary?: boolean
  withLinksummary?: boolean
  retainImages?: 'none' | 'all'
  noCache?: boolean
  withGeneratedAlt?: boolean
  respondWith?: 'no-content'
  returnFormat?: 'markdown' | 'html' | 'text' | 'screenshot' | 'pageshot'
}

export interface SearchResult {
  title: string
  description: string
  url: string
  content: string
}

export interface SearchResponse extends ToolResponse {
  output: {
    results: SearchResult[]
  }
}
