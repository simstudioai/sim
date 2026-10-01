import type { ToolResponse } from '@/tools/types'

interface LinkupSource {
  name: string
  url: string
  snippet: string
}

export interface LinkupSearchParams {
  q: string
  apiKey: string
  depth?: 'standard' | 'deep'
  outputType?: 'sourcedAnswer' | 'searchResults'
  includeImages?: boolean
  fromDate?: string
  toDate?: string
  excludeDomains?: string
  includeDomains?: string
  includeInlineCitations?: boolean
  includeSources?: boolean
}

export interface LinkupSearchResponse {
  answer?: string
  sources?: LinkupSource[]
  results?: any[]
  [key: string]: any
}

export interface LinkupSearchToolResponse extends ToolResponse {
  output: LinkupSearchResponse
}

interface LinkupFetchImage {
  alt: string
  url: string
}

export interface LinkupFetchParams {
  url: string
  apiKey: string
  renderJs?: boolean
  includeRawHtml?: boolean
  extractImages?: boolean
}

export interface LinkupFetchToolResponse extends ToolResponse {
  output: {
    markdown: string
    rawHtml: string | null
    images: LinkupFetchImage[]
    favicon: string | null
  }
}

export type LinkupResponse = LinkupSearchToolResponse | LinkupFetchToolResponse
