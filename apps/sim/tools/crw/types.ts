import type { OutputProperty, ToolResponse } from '@/tools/types'

/**
 * Shared output property definitions for fastCRW API responses.
 *
 * fastCRW is a Firecrawl-compatible web data engine (single Rust binary,
 * self-host or managed cloud). The REST shapes mirror Firecrawl's, so these
 * definitions follow the same structure as the Firecrawl provider.
 *
 * API Reference: https://fastcrw.com/docs/rest-api
 * - Scrape: POST /v1/scrape
 * - Crawl: POST /v1/crawl, GET /v1/crawl/{id}
 * - Search: POST /v1/search
 * - Map: POST /v1/map
 */

/**
 * Output definition for page metadata in scrape responses
 * Based on the fastCRW metadata object structure from POST /v1/scrape
 */
export const PAGE_METADATA_OUTPUT_PROPERTIES = {
  title: { type: 'string', description: 'Page title' },
  description: { type: 'string', description: 'Page meta description', optional: true },
  language: { type: 'string', description: 'Page language code (e.g., "en")', optional: true },
  sourceURL: { type: 'string', description: 'Original source URL that was scraped' },
  statusCode: { type: 'number', description: 'HTTP status code of the response' },
  keywords: { type: 'string', description: 'Page meta keywords', optional: true },
  robots: {
    type: 'string',
    description: 'Robots meta directive (e.g., "follow, index")',
    optional: true,
  },
  ogTitle: { type: 'string', description: 'Open Graph title', optional: true },
  ogDescription: { type: 'string', description: 'Open Graph description', optional: true },
  ogUrl: { type: 'string', description: 'Open Graph URL', optional: true },
  ogImage: { type: 'string', description: 'Open Graph image URL', optional: true },
  ogLocaleAlternate: {
    type: 'array',
    description: 'Alternate locale versions for Open Graph',
    optional: true,
    items: { type: 'string', description: 'Locale code' },
  },
  ogSiteName: { type: 'string', description: 'Open Graph site name', optional: true },
  error: { type: 'string', description: 'Error message if scrape failed', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete page metadata output definition
 */
export const PAGE_METADATA_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Page metadata including SEO and Open Graph information',
  properties: PAGE_METADATA_OUTPUT_PROPERTIES,
}

/**
 * Simplified metadata for crawl responses (subset of full metadata)
 * Based on crawl data[].metadata structure from GET /v1/crawl/{id}
 */
export const CRAWL_METADATA_OUTPUT_PROPERTIES = {
  title: { type: 'string', description: 'Page title' },
  description: { type: 'string', description: 'Page meta description', optional: true },
  language: { type: 'string', description: 'Page language code', optional: true },
  sourceURL: { type: 'string', description: 'Original source URL' },
  statusCode: { type: 'number', description: 'HTTP status code' },
  ogLocaleAlternate: {
    type: 'array',
    description: 'Alternate locale versions',
    optional: true,
    items: { type: 'string', description: 'Locale code' },
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete crawl metadata output definition
 */
export const CRAWL_METADATA_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Page metadata from crawl operation',
  properties: CRAWL_METADATA_OUTPUT_PROPERTIES,
}

/**
 * Search result metadata properties
 * Based on search data[].metadata structure from POST /v1/search
 */
export const SEARCH_METADATA_OUTPUT_PROPERTIES = {
  title: { type: 'string', description: 'Page title', optional: true },
  description: { type: 'string', description: 'Page meta description', optional: true },
  sourceURL: { type: 'string', description: 'Original source URL' },
  statusCode: { type: 'number', description: 'HTTP status code', optional: true },
  error: { type: 'string', description: 'Error message if scrape failed', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete search metadata output definition
 */
export const SEARCH_METADATA_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Metadata about the search result page',
  properties: SEARCH_METADATA_OUTPUT_PROPERTIES,
}

/**
 * Output properties for crawled page items
 * Based on GET /v1/crawl/{id} response data[] array items
 */
export const CRAWLED_PAGE_OUTPUT_PROPERTIES = {
  markdown: { type: 'string', description: 'Page content in markdown format' },
  html: { type: 'string', description: 'Processed HTML content of the page', optional: true },
  rawHtml: { type: 'string', description: 'Unprocessed raw HTML content', optional: true },
  links: {
    type: 'array',
    description: 'Array of links found on the page',
    optional: true,
    items: { type: 'string', description: 'URL found on the page' },
  },
  metadata: CRAWL_METADATA_OUTPUT,
} as const satisfies Record<string, OutputProperty>

/**
 * Output properties for search result items
 * Based on POST /v1/search response data[] array items
 */
export const SEARCH_RESULT_OUTPUT_PROPERTIES = {
  title: { type: 'string', description: 'Search result title from search engine' },
  description: {
    type: 'string',
    description: 'Search result description/snippet from search engine',
  },
  url: { type: 'string', description: 'URL of the search result' },
  markdown: {
    type: 'string',
    description: 'Page content in markdown (when sources include scraped content)',
    optional: true,
  },
  metadata: SEARCH_METADATA_OUTPUT,
} as const satisfies Record<string, OutputProperty>

// Common types
interface ScrapeOptions {
  formats?: string[]
  onlyMainContent?: boolean
  includeTags?: string[]
  excludeTags?: string[]
  headers?: Record<string, string>
  waitFor?: number
  renderJs?: boolean | null
  cssSelector?: string
  xpath?: string
  jsonSchema?: Record<string, any>
  proxy?: string
  stealth?: boolean
}

export interface ScrapeParams {
  apiKey: string
  baseUrl?: string
  url: string
  scrapeOptions?: ScrapeOptions
  // Additional top-level scrape params
  onlyMainContent?: boolean
  formats?: string[]
  includeTags?: string[]
  excludeTags?: string[]
  headers?: Record<string, string>
  waitFor?: number
  renderJs?: boolean | null
  cssSelector?: string
  xpath?: string
  jsonSchema?: Record<string, any>
  proxy?: string
  stealth?: boolean
}

export interface SearchParams {
  apiKey: string
  baseUrl?: string
  query: string
  limit?: number
  sources?: ('web' | 'images')[]
  scrapeOptions?: ScrapeOptions
}

export interface CrwCrawlParams {
  apiKey: string
  baseUrl?: string
  url: string
  maxPages?: number
  maxDepth?: number
  formats?: string[]
  onlyMainContent?: boolean
  scrapeOptions?: ScrapeOptions
}

export interface MapParams {
  apiKey: string
  baseUrl?: string
  url: string
  limit?: number
}

export interface ScrapeResponse extends ToolResponse {
  output: {
    markdown: string
    html?: string
    rawHtml?: string
    links?: string[]
    metadata: {
      title: string
      description?: string
      language?: string
      keywords?: string
      robots?: string
      ogTitle?: string
      ogDescription?: string
      ogUrl?: string
      ogImage?: string
      ogLocaleAlternate?: string[]
      ogSiteName?: string
      sourceURL: string
      statusCode: number
      error?: string
    }
  }
}

export interface SearchResponse extends ToolResponse {
  output: {
    data: Array<{
      title: string
      description: string
      url: string
      markdown?: string
      metadata?: {
        title?: string
        description?: string
        sourceURL: string
        statusCode?: number
        error?: string
      }
    }>
  }
}

export interface CrwCrawlResponse extends ToolResponse {
  output: {
    jobId?: string
    pages: Array<{
      markdown: string
      html?: string
      rawHtml?: string
      links?: string[]
      metadata: {
        title: string
        description?: string
        language?: string
        sourceURL: string
        statusCode: number
        ogLocaleAlternate?: string[]
      }
    }>
    total: number
  }
}

export interface MapResponse extends ToolResponse {
  output: {
    success: boolean
    links: string[]
  }
}

export type CrwResponse = ScrapeResponse | SearchResponse | CrwCrawlResponse | MapResponse
