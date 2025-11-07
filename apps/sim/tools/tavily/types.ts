import type { ToolResponse } from '@/tools/types'

export interface TavilySearchResult {
  title: string
  url: string
  content: string
  score: number
  images?: string[]
  raw_content?: string
}

export interface TavilySearchResponse extends ToolResponse {
  output: {
    results: TavilySearchResult[]
    answer?: string
    query: string
    images?: string[]
    rawContent?: string
  }
}

export interface TavilyExtractResponse extends ToolResponse {
  output: {
    content: string
    title: string
    url: string
    rawContent?: string
  }
}

export interface TavilyExtractParams {
  urls: string | string[]
  apiKey: string
  extract_depth?: 'basic' | 'advanced'
  format?: string
  include_images?: boolean
  include_favicon?: boolean
}

interface ExtractResult {
  url: string
  raw_content: string
}

export interface ExtractResponse extends ToolResponse {
  output: {
    results: ExtractResult[]
    failed_results?: Array<{
      url: string
      error: string
    }>
    response_time: number
  }
}

export interface TavilySearchParams {
  query: string
  apiKey: string
  max_results?: number
  topic?: string
  search_depth?: string
  include_answer?: string
  include_raw_content?: string
  include_images?: boolean
  include_image_descriptions?: boolean
  include_favicon?: boolean
  chunks_per_source?: number
  time_range?: string
  start_date?: string
  end_date?: string
  include_domains?: string
  exclude_domains?: string
  country?: string
  auto_parameters?: boolean
}

interface SearchResult {
  title: string
  url: string
  snippet: string
  raw_content?: string
}

export interface SearchResponse extends ToolResponse {
  output: {
    query: string
    results: SearchResult[]
    response_time: number
  }
}

export type TavilyResponse = TavilySearchResponse | TavilyExtractResponse

// Crawl API types
export interface TavilyCrawlParams {
  url: string
  apiKey: string
  instructions?: string
  max_depth?: number
  max_breadth?: number
  limit?: number
  select_paths?: string
  select_domains?: string
  exclude_paths?: string
  exclude_domains?: string
  allow_external?: boolean
  include_images?: boolean
  extract_depth?: string
  format?: string
  include_favicon?: boolean
}

interface CrawlResult {
  url: string
  raw_content: string
  favicon?: string
}

export interface CrawlResponse extends ToolResponse {
  output: {
    base_url: string
    results: CrawlResult[]
    response_time: number
    request_id?: string
  }
}

export interface TavilyCrawlResponse extends ToolResponse {
  output: {
    base_url: string
    results: CrawlResult[]
    response_time: number
    request_id?: string
  }
}

// Map API types
export interface TavilyMapParams {
  url: string
  apiKey: string
  instructions?: string
  max_depth?: number
  max_breadth?: number
  limit?: number
  select_paths?: string
  select_domains?: string
  exclude_paths?: string
  exclude_domains?: string
  allow_external?: boolean
}

interface MapResult {
  url: string
}

export interface MapResponse extends ToolResponse {
  output: {
    base_url: string
    results: MapResult[]
    response_time: number
    request_id?: string
  }
}

export interface TavilyMapResponse extends ToolResponse {
  output: {
    base_url: string
    results: MapResult[]
    response_time: number
    request_id?: string
  }
}
