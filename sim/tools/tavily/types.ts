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
