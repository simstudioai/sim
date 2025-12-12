import type { ToolResponse } from '@/tools/types'

// Common types
export interface LocationConfig {
  country?: string
  languages?: string[]
}

export interface ScrapeOptions {
  formats?: string[]
  onlyMainContent?: boolean
  includeTags?: string[]
  excludeTags?: string[]
  maxAge?: number
  headers?: Record<string, string>
  waitFor?: number
  mobile?: boolean
  skipTlsVerification?: boolean
  timeout?: number
  parsers?: string[]
  actions?: Array<{
    type: string
    [key: string]: any
  }>
  location?: LocationConfig
  removeBase64Images?: boolean
  blockAds?: boolean
  proxy?: 'basic' | 'stealth' | 'auto'
  storeInCache?: boolean
}

export interface ScrapeParams {
  apiKey: string
  url: string
  scrapeOptions?: ScrapeOptions
  // Additional top-level scrape params
  onlyMainContent?: boolean
  formats?: string[]
  includeTags?: string[]
  excludeTags?: string[]
  maxAge?: number
  headers?: Record<string, string>
  waitFor?: number
  mobile?: boolean
  skipTlsVerification?: boolean
  timeout?: number
  parsers?: string[]
  actions?: Array<{
    type: string
    [key: string]: any
  }>
  location?: LocationConfig
  removeBase64Images?: boolean
  blockAds?: boolean
  proxy?: 'basic' | 'stealth' | 'auto'
  storeInCache?: boolean
  zeroDataRetention?: boolean
}

export interface SearchParams {
  apiKey: string
  query: string
  limit?: number
  sources?: ('web' | 'images' | 'news')[]
  categories?: ('github' | 'research' | 'pdf')[]
  tbs?: string
  location?: string
  country?: string
  timeout?: number
  ignoreInvalidURLs?: boolean
  scrapeOptions?: ScrapeOptions
}

export interface FirecrawlCrawlParams {
  apiKey: string
  url: string
  limit?: number
  onlyMainContent?: boolean
  prompt?: string
  maxDiscoveryDepth?: number
  sitemap?: 'skip' | 'include'
  crawlEntireDomain?: boolean
  allowExternalLinks?: boolean
  allowSubdomains?: boolean
  ignoreQueryParameters?: boolean
  delay?: number
  maxConcurrency?: number
  excludePaths?: string[]
  includePaths?: string[]
  webhook?: {
    url: string
    headers?: Record<string, string>
    metadata?: Record<string, any>
    events?: ('completed' | 'page' | 'failed' | 'started')[]
  }
  scrapeOptions?: ScrapeOptions
  zeroDataRetention?: boolean
}

export interface MapParams {
  apiKey: string
  url: string
  search?: string
  sitemap?: 'skip' | 'include' | 'only'
  includeSubdomains?: boolean
  ignoreQueryParameters?: boolean
  limit?: number
  timeout?: number
  location?: LocationConfig
}

export interface ExtractParams {
  apiKey: string
  urls: string[]
  prompt?: string
  schema?: Record<string, any>
  enableWebSearch?: boolean
  ignoreSitemap?: boolean
  includeSubdomains?: boolean
  showSources?: boolean
  ignoreInvalidURLs?: boolean
  scrapeOptions?: ScrapeOptions
}

export interface ScrapeResponse extends ToolResponse {
  output: {
    markdown: string
    html?: string
    metadata: {
      title: string
      description: string
      language: string
      keywords: string
      robots: string
      ogTitle: string
      ogDescription: string
      ogUrl: string
      ogImage: string
      ogLocaleAlternate: string[]
      ogSiteName: string
      sourceURL: string
      statusCode: number
    }
  }
}

export interface SearchResponse extends ToolResponse {
  output: {
    data: Array<{
      title: string
      description: string
      url: string
      markdown?: string
      html?: string
      rawHtml?: string
      links?: string[]
      screenshot?: string
      metadata: {
        title: string
        description: string
        sourceURL: string
        statusCode: number
        error?: string
      }
    }>
    warning?: string
  }
}

export interface FirecrawlCrawlResponse extends ToolResponse {
  output: {
    jobId?: string
    pages: Array<{
      markdown: string
      html?: string
      metadata: {
        title: string
        description: string
        language: string
        sourceURL: string
        statusCode: number
      }
    }>
    total: number
    creditsUsed: number
  }
}

export interface MapResponse extends ToolResponse {
  output: {
    success: boolean
    links: string[]
  }
}

export interface ExtractResponse extends ToolResponse {
  output: {
    jobId: string
    success: boolean
    data: Record<string, any>
    sources?: Array<{
      url: string
      title?: string
    }>
    warning?: string
  }
}

export type FirecrawlResponse =
  | ScrapeResponse
  | SearchResponse
  | FirecrawlCrawlResponse
  | MapResponse
  | ExtractResponse
