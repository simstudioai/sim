import { ToolResponse } from '../types'

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
