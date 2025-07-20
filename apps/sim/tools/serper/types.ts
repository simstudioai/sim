import type { ToolResponse } from '@/tools/types'

export interface SearchParams {
  query: string
  apiKey: string
  num?: number
  gl?: string // country code
  hl?: string // language code
  type?: 'search' | 'news' | 'places' | 'images'
}

export interface SearchResult {
  title: string
  link: string
  snippet: string
  position: number
  imageUrl?: string
  date?: string
  rating?: string
  reviews?: string
  address?: string
}

export interface SearchResponse extends ToolResponse {
  output: {
    searchResults: SearchResult[]
  }
}
