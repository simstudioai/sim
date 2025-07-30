// Common types for Wikipedia tools
import type { ToolResponse } from '@/tools/types'

// Page Summary tool types
export interface WikipediaPageSummaryParams {
  pageTitle: string
}

export interface WikipediaPageSummary {
  type: string
  title: string
  displaytitle: string
  description?: string
  extract: string
  extract_html?: string
  thumbnail?: {
    source: string
    width: number
    height: number
  }
  originalimage?: {
    source: string
    width: number
    height: number
  }
  content_urls: {
    desktop: {
      page: string
      revisions: string
      edit: string
      talk: string
    }
    mobile: {
      page: string
      revisions: string
      edit: string
      talk: string
    }
  }
  lang: string
  dir: string
  timestamp: string
  pageid: number
  wikibase_item?: string
  coordinates?: {
    lat: number
    lon: number
  }
}

export interface WikipediaPageSummaryResponse extends ToolResponse {
  output: {
    summary: WikipediaPageSummary
  }
}

// Search Pages tool types
export interface WikipediaSearchParams {
  query: string
  searchLimit?: number
}

export interface WikipediaSearchResult {
  id: number
  key: string
  title: string
  excerpt: string
  matched_title?: string
  description?: string
  thumbnail?: {
    mimetype: string
    size?: number
    width: number
    height: number
    duration?: number
    url: string
  }
  url: string
}

export interface WikipediaSearchResponse extends ToolResponse {
  output: {
    searchResults: WikipediaSearchResult[]
    totalHits: number
    query: string
  }
}

// Get Page Content tool types
export interface WikipediaPageContentParams {
  pageTitle: string
}

export interface WikipediaPageContent {
  title: string
  pageid: number
  html: string
  revision: number
  tid: string
  timestamp: string
  content_model: string
  content_format: string
}

export interface WikipediaPageContentResponse extends ToolResponse {
  output: {
    content: WikipediaPageContent
  }
}

// Random Page tool types
export interface WikipediaRandomPage {
  type: string
  title: string
  displaytitle: string
  description?: string
  extract: string
  thumbnail?: {
    source: string
    width: number
    height: number
  }
  content_urls: {
    desktop: {
      page: string
    }
    mobile: {
      page: string
    }
  }
  lang: string
  timestamp: string
  pageid: number
}

export interface WikipediaRandomPageResponse extends ToolResponse {
  output: {
    randomPage: WikipediaRandomPage
  }
}

export type WikipediaResponse =
  | WikipediaPageSummaryResponse
  | WikipediaSearchResponse
  | WikipediaPageContentResponse
  | WikipediaRandomPageResponse
