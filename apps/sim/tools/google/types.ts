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
  htmlTitle: {
    type: 'string',
    description: 'Title of the search result with HTML markup',
    optional: true,
  },
  link: { type: 'string', description: 'URL of the search result' },
  displayLink: { type: 'string', description: 'Display URL (abbreviated form)', optional: true },
  snippet: { type: 'string', description: 'Snippet or description of the search result' },
  htmlSnippet: {
    type: 'string',
    description: 'Snippet of the search result with HTML markup',
    optional: true,
  },
  formattedUrl: {
    type: 'string',
    description: 'Display URL shown beneath the result',
    optional: true,
  },
  mime: { type: 'string', description: 'MIME type of the result', optional: true },
  fileFormat: { type: 'string', description: 'File format of the result', optional: true },
  cacheId: { type: 'string', description: "ID of Google's cached version", optional: true },
  pagemap: {
    type: 'object',
    description: 'PageMap information for the result (structured data)',
    optional: true,
  },
  image: {
    type: 'object',
    description: 'Image metadata (present when searchType is image)',
    optional: true,
    properties: {
      contextLink: { type: 'string', description: 'URL of the page hosting the image' },
      height: { type: 'number', description: 'Image height in pixels' },
      width: { type: 'number', description: 'Image width in pixels' },
      byteSize: { type: 'number', description: 'Image file size in bytes' },
      thumbnailLink: { type: 'string', description: 'Thumbnail image URL' },
      thumbnailHeight: { type: 'number', description: 'Thumbnail height in pixels' },
      thumbnailWidth: { type: 'number', description: 'Thumbnail width in pixels' },
    },
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
  start?: number | string
  dateRestrict?: string
  fileType?: string
  safe?: string
  searchType?: string
  siteSearch?: string
  siteSearchFilter?: string
  lr?: string
  gl?: string
  sort?: string
}

export interface GoogleSearchResponse extends ToolResponse {
  output: {
    items: Array<{
      title: string
      htmlTitle?: string
      link: string
      displayLink?: string
      snippet: string
      htmlSnippet?: string
      formattedUrl?: string
      mime?: string
      fileFormat?: string
      cacheId?: string
      pagemap?: Record<string, unknown>
      image?: {
        contextLink?: string
        height?: number
        width?: number
        byteSize?: number
        thumbnailLink?: string
        thumbnailHeight?: number
        thumbnailWidth?: number
      }
    }>
    searchInformation: {
      totalResults: string
      searchTime: number
      formattedSearchTime: string
      formattedTotalResults: string
    }
    nextPageStartIndex: number | null
  }
}
