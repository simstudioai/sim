import type { OutputProperty, ToolResponse } from '@/tools/types'

/**
 * Shared output property definitions for Firecrawl API responses.
 * Based on Firecrawl API documentation: https://docs.firecrawl.dev/api-reference
 *
 * API Response Reference:
 * - Scrape: https://docs.firecrawl.dev/api-reference/endpoint/scrape
 * - Crawl: https://docs.firecrawl.dev/api-reference/endpoint/crawl-get
 * - Search: https://docs.firecrawl.dev/api-reference/endpoint/search
 * - Map: https://docs.firecrawl.dev/api-reference/endpoint/map
 * - Extract: https://docs.firecrawl.dev/api-reference/endpoint/extract
 * - Agent: https://docs.firecrawl.dev/api-reference/endpoint/agent
 */

/**
 * Output definition for page metadata in scrape responses
 * Based on Firecrawl metadata object structure from POST /v2/scrape
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
 * Based on crawl data[].metadata structure from GET /v2/crawl/{id}
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
 * Based on search data[].metadata structure from POST /v2/search
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
 * Output properties for scrape tool response
 * Based on POST /v2/scrape response data object
 */
export const SCRAPE_OUTPUT_PROPERTIES = {
  markdown: { type: 'string', description: 'Page content converted to clean markdown format' },
  html: { type: 'string', description: 'Processed HTML content of the page', optional: true },
  rawHtml: { type: 'string', description: 'Unprocessed raw HTML content', optional: true },
  links: {
    type: 'array',
    description: 'Array of links found on the page',
    optional: true,
    items: { type: 'string', description: 'URL found on the page' },
  },
  screenshot: {
    type: 'string',
    description: 'Base64-encoded screenshot or URL (expires after 24 hours)',
    optional: true,
  },
  metadata: PAGE_METADATA_OUTPUT,
} as const satisfies Record<string, OutputProperty>

/**
 * Output properties for crawled page items
 * Based on GET /v2/crawl/{id} response data[] array items
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
  screenshot: {
    type: 'string',
    description: 'Screenshot URL (expires after 24 hours)',
    optional: true,
  },
  metadata: CRAWL_METADATA_OUTPUT,
} as const satisfies Record<string, OutputProperty>

/**
 * Complete crawled page output definition
 */
export const CRAWLED_PAGE_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Crawled page data with content and metadata',
  properties: CRAWLED_PAGE_OUTPUT_PROPERTIES,
}

/**
 * Output properties for crawl tool response
 * Based on GET /v2/crawl/{id} response (completed status)
 */
export const CRAWL_OUTPUT_PROPERTIES = {
  pages: {
    type: 'array',
    description: 'Array of crawled pages with their content and metadata',
    items: {
      type: 'object',
      properties: CRAWLED_PAGE_OUTPUT_PROPERTIES,
    },
  },
  total: { type: 'number', description: 'Total number of pages found during crawl' },
  creditsUsed: { type: 'number', description: 'Number of credits consumed by the crawl operation' },
} as const satisfies Record<string, OutputProperty>

/**
 * Output properties for search result items
 * Based on POST /v2/search response data[] array items
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
    description: 'Page content in markdown (when scrapeOptions.formats includes "markdown")',
    optional: true,
  },
  html: {
    type: 'string',
    description: 'Processed HTML content (when scrapeOptions.formats includes "html")',
    optional: true,
  },
  rawHtml: {
    type: 'string',
    description: 'Unprocessed raw HTML (when scrapeOptions.formats includes "rawHtml")',
    optional: true,
  },
  links: {
    type: 'array',
    description: 'Links found on the page (when scrapeOptions.formats includes "links")',
    optional: true,
    items: { type: 'string', description: 'URL found on the page' },
  },
  screenshot: {
    type: 'string',
    description:
      'Screenshot URL (expires after 24 hours, when scrapeOptions.formats includes "screenshot")',
    optional: true,
  },
  metadata: SEARCH_METADATA_OUTPUT,
} as const satisfies Record<string, OutputProperty>

/**
 * Complete search result output definition
 */
export const SEARCH_RESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Search result item with optional scraped content',
  properties: SEARCH_RESULT_OUTPUT_PROPERTIES,
}

/**
 * Output properties for search tool response
 * Based on POST /v2/search response
 */
export const SEARCH_OUTPUT_PROPERTIES = {
  data: {
    type: 'array',
    description: 'Array of search results with scraped content and metadata',
    items: {
      type: 'object',
      properties: SEARCH_RESULT_OUTPUT_PROPERTIES,
    },
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Output properties for map tool response
 * Based on POST /v2/map response
 */
export const MAP_OUTPUT_PROPERTIES = {
  success: { type: 'boolean', description: 'Whether the mapping operation completed successfully' },
  links: {
    type: 'array',
    description: 'Array of discovered URLs from the website',
    items: { type: 'string', description: 'Discovered URL' },
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Output properties for extract tool response
 * Based on GET /v2/extract/{id} response (completed status)
 */
export const EXTRACT_OUTPUT_PROPERTIES = {
  success: { type: 'boolean', description: 'Whether the extraction completed successfully' },
  data: {
    type: 'object',
    description: 'Extracted structured data according to the provided schema or prompt',
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Output properties for agent tool response
 * Based on GET /v2/agent/{id} response (completed status)
 */
export const AGENT_OUTPUT_PROPERTIES = {
  success: { type: 'boolean', description: 'Whether the agent task completed successfully' },
  status: {
    type: 'string',
    description: 'Current status of the agent job (processing, completed, failed)',
  },
  data: {
    type: 'object',
    description: 'Extracted data from the agent based on the prompt and schema',
  },
  creditsUsed: {
    type: 'number',
    description: 'Number of credits consumed by this agent task',
    optional: true,
  },
  expiresAt: {
    type: 'string',
    description: 'ISO timestamp when the results expire (24 hours after completion)',
    optional: true,
  },
  sources: {
    type: 'array',
    description: 'Array of source URLs visited and used by the agent',
    optional: true,
    items: { type: 'string', description: 'Source URL' },
  },
} as const satisfies Record<string, OutputProperty>

// Common types
export interface LocationConfig {
  country?: string
  languages?: string[]
}

export interface ScrapeOptions {
  formats?: string[]
  onlyMainContent?: boolean
  includeTags?: string[]
  excludeTags?: string[]
  maxAge?: number
  headers?: Record<string, string>
  waitFor?: number
  mobile?: boolean
  skipTlsVerification?: boolean
  timeout?: number
  parsers?: string[]
  actions?: Array<{
    type: string
    [key: string]: any
  }>
  location?: LocationConfig
  removeBase64Images?: boolean
  blockAds?: boolean
  proxy?: 'basic' | 'stealth' | 'auto'
  storeInCache?: boolean
}

export interface ScrapeParams {
  apiKey: string
  url: string
  scrapeOptions?: ScrapeOptions
  // Additional top-level scrape params
  onlyMainContent?: boolean
  formats?: string[]
  includeTags?: string[]
  excludeTags?: string[]
  maxAge?: number
  headers?: Record<string, string>
  waitFor?: number
  mobile?: boolean
  skipTlsVerification?: boolean
  timeout?: number
  parsers?: string[]
  actions?: Array<{
    type: string
    [key: string]: any
  }>
  location?: LocationConfig
  removeBase64Images?: boolean
  blockAds?: boolean
  proxy?: 'basic' | 'stealth' | 'auto'
  storeInCache?: boolean
  zeroDataRetention?: boolean
}

export interface SearchParams {
  apiKey: string
  query: string
  limit?: number
  sources?: ('web' | 'images' | 'news')[]
  categories?: ('github' | 'research' | 'pdf')[]
  tbs?: string
  location?: string
  country?: string
  timeout?: number
  ignoreInvalidURLs?: boolean
  scrapeOptions?: ScrapeOptions
}

export interface FirecrawlCrawlParams {
  apiKey: string
  url: string
  limit?: number
  maxDepth?: number
  formats?: string[]
  onlyMainContent?: boolean
  prompt?: string
  maxDiscoveryDepth?: number
  sitemap?: 'skip' | 'include'
  crawlEntireDomain?: boolean
  allowExternalLinks?: boolean
  allowSubdomains?: boolean
  ignoreQueryParameters?: boolean
  delay?: number
  maxConcurrency?: number
  excludePaths?: string[]
  includePaths?: string[]
  webhook?: {
    url: string
    headers?: Record<string, string>
    metadata?: Record<string, any>
    events?: ('completed' | 'page' | 'failed' | 'started')[]
  }
  scrapeOptions?: ScrapeOptions
  zeroDataRetention?: boolean
}

export interface MapParams {
  apiKey: string
  url: string
  search?: string
  sitemap?: 'skip' | 'include' | 'only'
  includeSubdomains?: boolean
  ignoreQueryParameters?: boolean
  limit?: number
  timeout?: number
  location?: LocationConfig
}

export interface ExtractParams {
  apiKey: string
  urls: string[]
  prompt?: string
  schema?: Record<string, any>
  enableWebSearch?: boolean
  ignoreSitemap?: boolean
  includeSubdomains?: boolean
  showSources?: boolean
  ignoreInvalidURLs?: boolean
  scrapeOptions?: ScrapeOptions
}

export interface AgentParams {
  apiKey: string
  prompt: string
  urls?: string[]
  schema?: Record<string, any>
  maxCredits?: number
  strictConstrainToURLs?: boolean
}

export interface ScrapeResponse extends ToolResponse {
  output: {
    markdown: string
    html?: string
    rawHtml?: string
    links?: string[]
    screenshot?: string
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
      html?: string
      rawHtml?: string
      links?: string[]
      screenshot?: string
      metadata: {
        title?: string
        description?: string
        sourceURL: string
        statusCode?: number
        error?: string
      }
    }>
  }
}

export interface FirecrawlCrawlResponse extends ToolResponse {
  output: {
    jobId?: string
    pages: Array<{
      markdown: string
      html?: string
      rawHtml?: string
      links?: string[]
      screenshot?: string
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
    creditsUsed: number
  }
}

export interface MapResponse extends ToolResponse {
  output: {
    success: boolean
    links: string[]
  }
}

export interface ExtractResponse extends ToolResponse {
  output: {
    jobId: string
    success: boolean
    data: Record<string, any>
  }
}

export interface AgentResponse extends ToolResponse {
  output: {
    jobId: string
    success: boolean
    status: string
    data: Record<string, any>
    creditsUsed?: number
    expiresAt?: string
    sources?: string[]
  }
}

export type FirecrawlResponse =
  | ScrapeResponse
  | SearchResponse
  | FirecrawlCrawlResponse
  | MapResponse
  | ExtractResponse
  | AgentResponse
