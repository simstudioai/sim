import type { OutputProperty, ToolResponse } from '@/tools/types'

/**
 * Shared output property definitions for SERPdive API responses.
 * Based on the SERPdive API reference: https://serpdive.com/openapi.json
 */

/**
 * Output definition for a delivered search result
 */
export const SERPDIVE_SEARCH_RESULT_OUTPUT_PROPERTIES = {
  url: { type: 'string', description: 'Result URL, tracking parameters stripped' },
  title: { type: 'string', description: 'Page title', optional: true },
  content: {
    type: 'string',
    description: 'Extracted, answer-ready content of the page',
  },
  date: {
    type: 'string',
    description: 'Publication date when known, ISO YYYY-MM-DD',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export interface SerpdiveSearchParams {
  query: string
  apiKey: string
  model?: 'mako' | 'moby'
  answer?: boolean
  max_results?: number
}

export interface SerpdiveSearchResult {
  url: string
  title: string | null
  content: string
  date: string | null
}

export interface SerpdiveSearchResponse extends ToolResponse {
  output: {
    query: string
    results: SerpdiveSearchResult[]
    model?: string
    response_time_ms?: number
    answer?: string
    extra_info?: Record<string, any>
  }
}
