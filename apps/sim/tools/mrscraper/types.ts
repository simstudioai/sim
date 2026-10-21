import type { ToolFileData, ToolResponse } from '@/tools/types'

export interface MrScraperScrapeParams {
  apiKey: string
  url: string
  html?: boolean
  markdown?: boolean
  screenshot?: boolean
  browserRendering?: 'auto' | 'true' | 'false'
  super?: boolean
  geoCode?: string
  proxyCountry?: string
  timeout?: number
  maxRetries?: number
  tokenCap?: number
  waitForSelector?: string
  blockResources?: boolean
  homePage?: boolean
  useProxy?: boolean
  proxy?: string
  bypassProxy?: boolean
  cookieJar?: string
  headers?: Record<string, string> | string
}

export interface MrScraperScrapeResponse extends ToolResponse {
  output: {
    html: string | null
    markdown: string | null
    screenshot?: ToolFileData
    tokenUsage: number | null
    runtime: number | null
    retryCount: number | null
    targetStatusCode: number | null
    error: string | null
  }
}

export interface MrScraperSearchParams {
  apiKey: string
  query: string
  format?: 'json' | 'html'
  region?: string
  language?: string
  page?: number
  renderJs?: boolean
}

export interface MrScraperSearchResponse extends ToolResponse {
  output: {
    searchResults: {
      title: string | null
      link: string | null
      description: string | null
      source: string | null
      displayLink: string | null
      rank: number | null
      globalRank: number | null
    }[]
    html: string | null
    general: {
      query: string | null
      resultsCount: number | null
      searchTime: number | null
      language: string | null
      location: string | null
      pageTitle: string | null
      timestamp: string | null
    } | null
    pagination: {
      currentPage: number | null
      nextPage: number | null
      nextPageStart: number | null
      nextPageLink: string | null
      pages: {
        page: number | null
        start: number | null
        link: string | null
      }[]
    } | null
    tokenUsage: number | null
  }
}

export interface MrScraperGetAccountParams {
  apiKey: string
}

export interface MrScraperGetAccountResponse extends ToolResponse {
  output: {
    subscriptionStatus: string | null
    enterprise: boolean
    tokenUsage: number
    tokenLimit: number
    tokenRemaining: number
    usagePercent: number
    rateLimit: number
    rateTtl: number
    autoRenew: boolean
    endsAt: string | null
    user: {
      name: string | null
      email: string | null
      verified: boolean
    }
  }
}
