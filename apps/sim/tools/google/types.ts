import type { OutputProperty, ToolResponse } from '@/tools/types'

/**
 * Output property definitions for Google Custom Search API responses.
 * @see https://developers.google.com/custom-search/v1/reference/rest/v1/Search
 */

/**
 * Output definition for search result item objects.
 * @see https://developers.google.com/custom-search/v1/reference/rest/v1/Search#Result
 */
export const GOOGLE_SEARCH_RESULT_OUTPUT_PROPERTIES = {
  title: { type: 'string', description: 'Title of the search result' },
  link: { type: 'string', description: 'URL of the search result' },
  snippet: { type: 'string', description: 'Snippet or description of the search result' },
  displayLink: { type: 'string', description: 'Display URL (abbreviated form)', optional: true },
  pagemap: {
    type: 'object',
    description: 'PageMap information for the result (structured data)',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete search result item output definition
 */
export const GOOGLE_SEARCH_RESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'A single search result from Google Custom Search',
  properties: GOOGLE_SEARCH_RESULT_OUTPUT_PROPERTIES,
}

/**
 * Output definition for search information metadata.
 * @see https://developers.google.com/custom-search/v1/reference/rest/v1/Search#SearchInformation
 */
export const GOOGLE_SEARCH_INFORMATION_OUTPUT_PROPERTIES = {
  totalResults: { type: 'string', description: 'Total number of search results available' },
  searchTime: { type: 'number', description: 'Time taken to perform the search in seconds' },
  formattedSearchTime: { type: 'string', description: 'Formatted search time for display' },
  formattedTotalResults: {
    type: 'string',
    description: 'Formatted total results count for display',
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete search information output definition
 */
export const GOOGLE_SEARCH_INFORMATION_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Information about the search query and results',
  properties: GOOGLE_SEARCH_INFORMATION_OUTPUT_PROPERTIES,
}

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
