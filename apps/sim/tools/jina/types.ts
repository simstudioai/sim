import type { ToolResponse } from '@/tools/types'

export interface ReadUrlParams {
  url: string
  // Existing params (backward compatible)
  useReaderLMv2?: boolean
  gatherLinks?: boolean
  jsonResponse?: boolean
  apiKey?: string
  // New content extraction params
  targetSelector?: string
  waitForSelector?: string
  removeSelector?: string
  timeout?: number
  withImagesummary?: boolean
  retainImages?: 'none' | 'all'
  returnFormat?: 'markdown' | 'html' | 'text' | 'screenshot' | 'pageshot'
  withIframe?: boolean
  withShadowDom?: boolean
  // Authentication & proxy
  setCookie?: string
  proxyUrl?: string
  proxy?: string
  // Performance & caching
  engine?: 'browser' | 'direct' | 'cf-browser-rendering'
  tokenBudget?: number
  noCache?: boolean
  cacheTolerance?: number
  // Advanced options
  withGeneratedAlt?: boolean
  baseUrl?: 'final'
  locale?: string
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
  // Geographic & language params
  gl?: string
  location?: string
  hl?: string
  // Pagination
  num?: number
  page?: number
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
  engine?: 'browser' | 'direct'
  timeout?: number
  setCookie?: string
  proxyUrl?: string
  locale?: string
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
