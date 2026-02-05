import type { OutputProperty, ToolResponse } from '@/tools/types'

/**
 * Output definition for search result items
 */
export const BOCHA_SEARCH_RESULT_OUTPUT_PROPERTIES = {
  title: { type: 'string', description: 'Result title' },
  url: { type: 'string', description: 'Result URL' },
  snippet: { type: 'string', description: 'Brief description or content snippet' },
} as const satisfies Record<string, OutputProperty>


export interface BoChaSearchResult {
  title: string
  url: string
  snippet: string
}

export interface BoChaSearchResponse extends ToolResponse {
  output: {
    results: BoChaSearchResult[]
    query: string
  }
}


export interface BoChaSearchParams {
  query: string
  freshness: string
  summary: boolean
  count: number
  include: string
  exclude: string
  apiKey: string
}



