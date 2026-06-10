import type { ToolResponse } from '@/tools/types'

export interface YouSearchParams {
  query: string
  count?: number
  offset?: number
  freshness?: string
  country?: string
  language?: string
  safesearch?: string
  livecrawl?: string
  include_domains?: string
  exclude_domains?: string
  apiKey: string
}

interface YouWebResult {
  url: string | null
  title: string | null
  description: string | null
  snippets: string[]
  page_age: string | null
  author: string | null
  favicon_url: string | null
  thumbnail_url: string | null
  contents: Record<string, unknown> | null
}

interface YouNewsResult {
  url: string | null
  title: string | null
  description: string | null
  page_age: string | null
  thumbnail_url: string | null
  contents: Record<string, unknown> | null
}

export interface YouSearchResponse extends ToolResponse {
  output: {
    search_uuid: string | null
    web: YouWebResult[]
    news: YouNewsResult[]
  }
}

export interface YouContentsParams {
  urls: string
  format?: string
  crawl_timeout?: number
  apiKey: string
}

interface YouContentsResult {
  url: string | null
  title: string | null
  markdown: string | null
  html: string | null
  metadata: Record<string, unknown> | null
}

export interface YouContentsResponse extends ToolResponse {
  output: {
    results: YouContentsResult[]
  }
}

interface YouResearchSource {
  url: string | null
  title: string | null
  snippets: string[]
}

export interface YouResearchParams {
  input: string
  research_effort?: string
  apiKey: string
}

export interface YouResearchResponse extends ToolResponse {
  output: {
    content: string | null
    content_type: string | null
    sources: YouResearchSource[]
  }
}

export interface YouFinanceParams {
  input: string
  research_effort?: string
  apiKey: string
}

export type YouFinanceResponse = YouResearchResponse
