import type { ToolResponse } from '@/tools/types'

export interface GoogleSearchParams {
  query: string
  apiKey: string
  searchEngineId: string
  num?: number | string
}

export interface GoogleSearchResponse extends ToolResponse {
  output: {
    items: Array<{
      title: string
      link: string
      snippet: string
      displayLink?: string
      pagemap?: Record<string, any>
    }>
    searchInformation: {
      totalResults: string
      searchTime: number
      formattedSearchTime: string
      formattedTotalResults: string
    }
  }
}
