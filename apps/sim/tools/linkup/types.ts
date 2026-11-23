import type { ToolResponse } from '@/tools/types'

interface LinkupSource {
  name: string
  url: string
  snippet: string
}

export interface LinkupSearchParams {
  q: string
  apiKey: string
  depth?: 'flash' | 'fast' | 'standard' | 'deep'
  outputType?: 'sourcedAnswer' | 'searchResults'
  includeImages?: boolean
  fromDate?: string
  toDate?: string
  excludeDomains?: string
  includeDomains?: string
  includeInlineCitations?: boolean
  includeSources?: boolean
  maxResults?: number
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
