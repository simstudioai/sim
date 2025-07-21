import type { ToolResponse } from '@/tools/types'

export interface ScrapeParams {
  apiKey: string
  url: string
  scrapeOptions?: {
    onlyMainContent?: boolean
    formats?: string[]
  }
}

export interface SearchParams {
  apiKey: string
  query: string
}

export interface FirecrawlCrawlParams {
  apiKey: string
  url: string
  limit?: number
  onlyMainContent?: boolean
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

export type FirecrawlResponse = ScrapeResponse | SearchResponse | FirecrawlCrawlResponse
