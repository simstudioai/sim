import type { OutputProperty, ToolResponse } from '@/tools/types'

/**
 * Shared output property definitions for Jina AI API responses.
 * Based on Jina AI documentation: https://jina.ai/reader/
 */

/**
 * Output definition for usage/token information
 * Based on Jina AI API usage object
 */
export const JINA_USAGE_OUTPUT_PROPERTIES = {
  tokens: { type: 'number', description: 'Number of tokens consumed by this request' },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete usage output definition
 */
export const JINA_USAGE_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Token usage information for this request',
  properties: JINA_USAGE_OUTPUT_PROPERTIES,
}

/**
 * Core data properties for Reader API responses
 * Based on Jina AI Reader API response structure
 */
export const JINA_READER_DATA_OUTPUT_PROPERTIES = {
  title: { type: 'string', description: 'Page title' },
  description: { type: 'string', description: 'Page meta description', optional: true },
  url: { type: 'string', description: 'The URL that was processed' },
  content: {
    type: 'string',
    description: 'Main content extracted from the page in markdown format',
  },
  images: {
    type: 'json',
    description: 'Dictionary of images found on the page (image caption/name to URL)',
    optional: true,
  },
  links: {
    type: 'json',
    description: 'Dictionary of links found on the page (link text to URL)',
    optional: true,
  },
  usage: {
    type: 'object',
    description: 'Token usage information',
    optional: true,
    properties: JINA_USAGE_OUTPUT_PROPERTIES,
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Output definition for search result items
 */
export const JINA_SEARCH_RESULT_OUTPUT_PROPERTIES = {
  title: { type: 'string', description: 'Page title' },
  description: {
    type: 'string',
    description: 'Page description or meta description',
    optional: true,
  },
  url: { type: 'string', description: 'Page URL' },
  content: { type: 'string', description: 'LLM-friendly extracted content' },
  usage: {
    type: 'object',
    description: 'Token usage information',
    optional: true,
    properties: JINA_USAGE_OUTPUT_PROPERTIES,
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete search result output definition
 */
export const JINA_SEARCH_RESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Search result with extracted content',
  properties: JINA_SEARCH_RESULT_OUTPUT_PROPERTIES,
}

/**
 * Search results array output definition
 */
export const JINA_SEARCH_RESULTS_OUTPUT: OutputProperty = {
  type: 'array',
  description: 'Array of search results with LLM-friendly content',
  items: {
    type: 'object',
    properties: JINA_SEARCH_RESULT_OUTPUT_PROPERTIES,
  },
}

export interface ReadUrlParams {
  url: string
  // Existing params (backward compatible)
  useReaderLMv2?: boolean
  gatherLinks?: boolean
  jsonResponse?: boolean
  apiKey?: string
  // Content extraction params
  withImagesummary?: boolean
  retainImages?: 'none' | 'all'
  returnFormat?: 'markdown' | 'html' | 'text' | 'screenshot' | 'pageshot'
  withIframe?: boolean
  withShadowDom?: boolean
  // Performance & caching
  noCache?: boolean
  // Advanced options
  withGeneratedAlt?: boolean
  robotsTxt?: string
  dnt?: boolean
  noGfm?: boolean
}

export interface ReadUrlResponse extends ToolResponse {
  output: {
    content: string
  }
}

export interface SearchParams {
  q: string
  apiKey?: string
  // Pagination
  num?: number
  // Site restriction
  site?: string | string[]
  // Content options
  withFavicon?: boolean
  withImagesummary?: boolean
  withLinksummary?: boolean
  retainImages?: 'none' | 'all'
  noCache?: boolean
  withGeneratedAlt?: boolean
  respondWith?: 'no-content'
  returnFormat?: 'markdown' | 'html' | 'text' | 'screenshot' | 'pageshot'
}

export interface SearchResult {
  title: string
  description: string
  url: string
  content: string
}

export interface SearchResponse extends ToolResponse {
  output: {
    results: SearchResult[]
  }
}
