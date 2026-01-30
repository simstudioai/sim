import type { OutputProperty, ToolResponse } from '@/tools/types'

/**
 * Shared output property definitions for Tavily API responses.
 * Based on Tavily API documentation: https://docs.tavily.com/documentation/api-reference
 */

/**
 * Output definition for search result items
 */
export const TAVILY_SEARCH_RESULT_OUTPUT_PROPERTIES = {
  title: { type: 'string', description: 'Result title' },
  url: { type: 'string', description: 'Result URL' },
  content: { type: 'string', description: 'Brief description or content snippet' },
  score: { type: 'number', description: 'Relevance score', optional: true },
  raw_content: {
    type: 'string',
    description: 'Full parsed HTML content (if requested)',
    optional: true,
  },
  favicon: { type: 'string', description: 'Favicon URL for the domain', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete search result output definition
 */
export const TAVILY_SEARCH_RESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Search result item',
  properties: TAVILY_SEARCH_RESULT_OUTPUT_PROPERTIES,
}

/**
 * Output definition for image items in search results
 */
export const TAVILY_IMAGE_OUTPUT_PROPERTIES = {
  url: { type: 'string', description: 'Image URL' },
  description: { type: 'string', description: 'Image description', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete image output definition
 */
export const TAVILY_IMAGE_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Image result',
  properties: TAVILY_IMAGE_OUTPUT_PROPERTIES,
}

/**
 * Output definition for usage statistics
 */
export const TAVILY_USAGE_OUTPUT_PROPERTIES = {
  credits: { type: 'number', description: 'Number of credits consumed' },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete usage output definition
 */
export const TAVILY_USAGE_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Credit usage details',
  properties: TAVILY_USAGE_OUTPUT_PROPERTIES,
}

/**
 * Output definition for extract result items
 */
export const TAVILY_EXTRACT_RESULT_OUTPUT_PROPERTIES = {
  url: { type: 'string', description: 'The source URL' },
  raw_content: { type: 'string', description: 'Full extracted content from the page' },
  images: {
    type: 'array',
    description: 'Image URLs (when include_images is true)',
    optional: true,
    items: { type: 'string' },
  },
  favicon: { type: 'string', description: 'Favicon URL for the result', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete extract result output definition
 */
export const TAVILY_EXTRACT_RESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Extracted content from URL',
  properties: TAVILY_EXTRACT_RESULT_OUTPUT_PROPERTIES,
}

/**
 * Output definition for failed extraction items
 */
export const TAVILY_FAILED_RESULT_OUTPUT_PROPERTIES = {
  url: { type: 'string', description: 'The URL that failed extraction' },
  error: { type: 'string', description: 'Error message describing why extraction failed' },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete failed result output definition
 */
export const TAVILY_FAILED_RESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Failed extraction result',
  properties: TAVILY_FAILED_RESULT_OUTPUT_PROPERTIES,
}

/**
 * Output definition for crawl result items
 */
export const TAVILY_CRAWL_RESULT_OUTPUT_PROPERTIES = {
  url: { type: 'string', description: 'The crawled page URL' },
  raw_content: { type: 'string', description: 'Full extracted page content' },
  favicon: { type: 'string', description: 'Favicon URL for the result', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete crawl result output definition
 */
export const TAVILY_CRAWL_RESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Crawled page result',
  properties: TAVILY_CRAWL_RESULT_OUTPUT_PROPERTIES,
}

/**
 * Output definition for map result items
 */
export const TAVILY_MAP_RESULT_OUTPUT_PROPERTIES = {
  url: { type: 'string', description: 'Discovered URL' },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete map result output definition
 */
export const TAVILY_MAP_RESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Mapped URL result',
  properties: TAVILY_MAP_RESULT_OUTPUT_PROPERTIES,
}

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

export interface TavilyExtractParams {
  urls: string | string[]
  apiKey: string
  extract_depth?: 'basic' | 'advanced'
  format?: string
  include_images?: boolean
  include_favicon?: boolean
}

interface ExtractResult {
  url: string
  raw_content: string
}

export interface ExtractResponse extends ToolResponse {
  output: {
    results: ExtractResult[]
    failed_results?: Array<{
      url: string
      error: string
    }>
    response_time: number
  }
}

export interface TavilySearchParams {
  query: string
  apiKey: string
  max_results?: number
  topic?: string
  search_depth?: string
  include_answer?: string
  include_raw_content?: string
  include_images?: boolean
  include_image_descriptions?: boolean
  include_favicon?: boolean
  chunks_per_source?: number
  time_range?: string
  start_date?: string
  end_date?: string
  include_domains?: string
  exclude_domains?: string
  country?: string
  auto_parameters?: boolean
}

interface SearchResult {
  title: string
  url: string
  snippet: string
  raw_content?: string
}

export interface SearchResponse extends ToolResponse {
  output: {
    query: string
    results: SearchResult[]
    response_time: number
  }
}

export type TavilyResponse = TavilySearchResponse | TavilyExtractResponse

// Crawl API types
export interface TavilyCrawlParams {
  url: string
  apiKey: string
  instructions?: string
  max_depth?: number
  max_breadth?: number
  limit?: number
  select_paths?: string
  select_domains?: string
  exclude_paths?: string
  exclude_domains?: string
  allow_external?: boolean
  include_images?: boolean
  extract_depth?: string
  format?: string
  include_favicon?: boolean
}

interface CrawlResult {
  url: string
  raw_content: string
  favicon?: string
}

export interface CrawlResponse extends ToolResponse {
  output: {
    base_url: string
    results: CrawlResult[]
    response_time: number
    request_id?: string
  }
}

export interface TavilyCrawlResponse extends ToolResponse {
  output: {
    base_url: string
    results: CrawlResult[]
    response_time: number
    request_id?: string
  }
}

// Map API types
export interface TavilyMapParams {
  url: string
  apiKey: string
  instructions?: string
  max_depth?: number
  max_breadth?: number
  limit?: number
  select_paths?: string
  select_domains?: string
  exclude_paths?: string
  exclude_domains?: string
  allow_external?: boolean
}

interface MapResult {
  url: string
}

export interface MapResponse extends ToolResponse {
  output: {
    base_url: string
    results: MapResult[]
    response_time: number
    request_id?: string
  }
}

export interface TavilyMapResponse extends ToolResponse {
  output: {
    base_url: string
    results: MapResult[]
    response_time: number
    request_id?: string
  }
}
