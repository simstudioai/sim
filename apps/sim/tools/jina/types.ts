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

interface SearchResult {
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
