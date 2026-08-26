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
  sourceURL: {
    type: 'string',
    description: 'The originally requested URL, before any redirects were followed',
  },
  url: {
    type: 'string',
    description: 'The final URL of the page after all redirects were followed',
    optional: true,
  },
  statusCode: { type: 'number', description: 'HTTP status code', optional: true },
  numPages: {
    type: 'number',
    description:
      'For PDF inputs, the number of pages parsed (capped by the parser maxPages option)',
    optional: true,
  },
  totalPages: {
    type: 'number',
    description:
      "For PDF inputs, the document's true page count before maxPages capping; greater than numPages means the result was truncated",
    optional: true,
  },
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
 * Content a `web` or `news` search result carries only when `scrapeOptions`
 * asked Firecrawl to scrape the page behind it. `images` results are never
 * scraped, so they share none of these fields.
 *
 * Based on the `data.web[]` / `data.news[]` items of POST /v2/search.
 */
const SEARCH_SCRAPED_OUTPUT_PROPERTIES = {
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
  audio: {
    type: 'string',
    description:
      'Signed URL to the extracted MP3 (when scrapeOptions.formats includes "audio"); expires after 1 hour',
    optional: true,
  },
  video: {
    type: 'string',
    description:
      'Signed URL to the extracted video (when scrapeOptions.formats includes "video"); expires after 1 hour',
    optional: true,
  },
  metadata: { ...SEARCH_METADATA_OUTPUT, optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Output properties for `data.web[]` items of POST /v2/search.
 */
export const SEARCH_WEB_RESULT_OUTPUT_PROPERTIES = {
  title: { type: 'string', description: 'Title from the search result' },
  description: { type: 'string', description: 'Description from the search result' },
  url: { type: 'string', description: 'URL of the search result' },
  ...SEARCH_SCRAPED_OUTPUT_PROPERTIES,
} as const satisfies Record<string, OutputProperty>

/**
 * Output properties for `data.news[]` items of POST /v2/search.
 *
 * News results carry `snippet`, not `description`, and `imageUrl` here is the
 * article's thumbnail — unlike on an `images` result, where it is the image
 * itself. `position` is 1-based *within this array*, not across sources.
 */
export const SEARCH_NEWS_RESULT_OUTPUT_PROPERTIES = {
  title: { type: 'string', description: 'Title of the article' },
  snippet: { type: 'string', description: 'Snippet from the article' },
  url: { type: 'string', description: 'URL of the article' },
  date: { type: 'string', description: 'Date of the article', optional: true },
  imageUrl: { type: 'string', description: "URL of the article's image", optional: true },
  position: {
    type: 'number',
    description: 'Rank of the article within the news results (1-based)',
    optional: true,
  },
  ...SEARCH_SCRAPED_OUTPUT_PROPERTIES,
} as const satisfies Record<string, OutputProperty>

/**
 * Output properties for `data.images[]` items of POST /v2/search.
 *
 * `url` is the page that *contains* the image; `imageUrl` is the image itself.
 * Image results are never scraped, so they carry no content or metadata.
 */
export const SEARCH_IMAGE_RESULT_OUTPUT_PROPERTIES = {
  title: { type: 'string', description: 'Title from the search result' },
  imageUrl: { type: 'string', description: 'URL of the image itself' },
  imageWidth: { type: 'number', description: 'Width of the image in pixels', optional: true },
  imageHeight: { type: 'number', description: 'Height of the image in pixels', optional: true },
  url: { type: 'string', description: 'URL of the page containing the image' },
  position: {
    type: 'number',
    description: 'Rank of the result within the image results (1-based)',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

/**
 * The `data` envelope of POST /v2/search.
 *
 * Firecrawl groups results by source rather than under one generic array:
 * "The arrays available will depend on the sources you specified in the
 * request. By default, the `web` array will be returned." Every array is
 * therefore optional, and each keeps its own item shape — a news `snippet` and
 * an image `imageUrl` have no equivalent on a web result and would be lost if
 * the sources were merged.
 */
export const SEARCH_DATA_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Search results, grouped by the sources requested',
  properties: {
    web: {
      type: 'array',
      description: 'Web results (returned by default, or when "web" is in sources)',
      optional: true,
      items: { type: 'object', properties: SEARCH_WEB_RESULT_OUTPUT_PROPERTIES },
    },
    news: {
      type: 'array',
      description: 'News results (only when "news" is in sources)',
      optional: true,
      items: { type: 'object', properties: SEARCH_NEWS_RESULT_OUTPUT_PROPERTIES },
    },
    images: {
      type: 'array',
      description: 'Image results (only when "images" is in sources)',
      optional: true,
      items: { type: 'object', properties: SEARCH_IMAGE_RESULT_OUTPUT_PROPERTIES },
    },
  },
}

// Common types
interface LocationConfig {
  country?: string
  languages?: string[]
}

export type FirecrawlFormat =
  | string
  | {
      type: string
      prompt?: string
      schema?: Record<string, unknown>
      question?: string
      [key: string]: unknown
    }

export interface ScrapeOptions {
  formats?: FirecrawlFormat[]
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
  formats?: FirecrawlFormat[]
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
  formats?: FirecrawlFormat[]
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
    creditsUsed?: number
  }
}

/** One result inside a Firecrawl search source array (`data.web`, `data.news`, ...). */
interface FirecrawlSearchMetadata {
  title?: string
  description?: string
  sourceURL: string
  url?: string
  statusCode?: number
  numPages?: number
  totalPages?: number
  error?: string | null
}

/** Fields present on a web or news result only when scrapeOptions were sent. */
interface FirecrawlScrapedSearchFields {
  markdown?: string | null
  html?: string | null
  rawHtml?: string | null
  links?: string[]
  screenshot?: string | null
  audio?: string | null
  video?: string | null
  metadata?: FirecrawlSearchMetadata
}

export interface FirecrawlWebSearchResult extends FirecrawlScrapedSearchFields {
  title: string
  description: string
  url: string
}

export interface FirecrawlNewsSearchResult extends FirecrawlScrapedSearchFields {
  title: string
  snippet: string
  url: string
  date?: string
  imageUrl?: string
  position?: number
}

export interface FirecrawlImageSearchResult {
  title: string
  imageUrl: string
  imageWidth?: number
  imageHeight?: number
  url: string
  position?: number
}

/**
 * The source-keyed `data` envelope. Which arrays appear depends on the
 * requested `sources`, so all three are optional.
 */
export interface FirecrawlSearchData {
  web?: FirecrawlWebSearchResult[]
  news?: FirecrawlNewsSearchResult[]
  images?: FirecrawlImageSearchResult[]
}

export interface SearchResponse extends ToolResponse {
  output: {
    data: FirecrawlSearchData
    warning?: string
    id?: string
    creditsUsed?: number
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
    creditsUsed?: number
  }
}

export interface MapResponse extends ToolResponse {
  output: {
    success: boolean
    links: string[]
    creditsUsed?: number
  }
}

export interface ExtractResponse extends ToolResponse {
  output: {
    jobId: string
    success: boolean
    data: Record<string, any>
    creditsUsed?: number
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

export interface ParseParams {
  apiKey: string
  file: unknown
  formats?: FirecrawlFormat[]
  onlyMainContent?: boolean
  includeTags?: string[]
  excludeTags?: string[]
  timeout?: number
  parsers?: Array<{ type: string; mode?: string } | string>
  removeBase64Images?: boolean
  blockAds?: boolean
  proxy?: 'basic' | 'auto'
  zeroDataRetention?: boolean
}

export interface ParseResponse extends ToolResponse {
  output: {
    markdown: string
    summary?: string | null
    html?: string | null
    rawHtml?: string | null
    screenshot?: string | null
    links?: string[]
    metadata?: {
      title?: string | string[]
      description?: string | string[]
      language?: string | string[] | null
      sourceURL?: string
      url?: string
      keywords?: string | string[]
      statusCode?: number
      contentType?: string
      error?: string | null
    } | null
    warning?: string | null
  }
}

interface CrawledPage {
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
}

export interface FirecrawlCrawlStatusParams {
  apiKey: string
  jobId: string
}

export interface FirecrawlCrawlStatusResponse extends ToolResponse {
  output: {
    status: string
    total: number
    completed: number
    creditsUsed: number
    expiresAt?: string | null
    next?: string | null
    pages: CrawledPage[]
  }
}

export interface FirecrawlCancelCrawlParams {
  apiKey: string
  jobId: string
}

export interface FirecrawlCancelCrawlResponse extends ToolResponse {
  output: {
    status: string
  }
}

export interface FirecrawlBatchScrapeParams {
  apiKey: string
  urls: string[] | string
  formats?: FirecrawlFormat[]
  onlyMainContent?: boolean
  maxConcurrency?: number
  ignoreInvalidURLs?: boolean
  scrapeOptions?: ScrapeOptions
  zeroDataRetention?: boolean
}

export interface FirecrawlBatchScrapeResponse extends ToolResponse {
  output: {
    jobId?: string
    invalidURLs?: string[]
    pages: CrawledPage[]
    total: number
    completed: number
    creditsUsed?: number
  }
}

export interface FirecrawlBatchScrapeStatusParams {
  apiKey: string
  jobId: string
}

export interface FirecrawlBatchScrapeStatusResponse extends ToolResponse {
  output: {
    status: string
    total: number
    completed: number
    creditsUsed: number
    expiresAt?: string | null
    next?: string | null
    pages: CrawledPage[]
  }
}

export interface FirecrawlExtractStatusParams {
  apiKey: string
  jobId: string
}

export interface FirecrawlExtractStatusResponse extends ToolResponse {
  output: {
    status: string
    data: Record<string, any> | unknown[]
    expiresAt?: string | null
    creditsUsed?: number | null
    tokensUsed?: number | null
  }
}

export interface FirecrawlCreditUsageParams {
  apiKey: string
}

export interface FirecrawlCreditUsageResponse extends ToolResponse {
  output: {
    remainingCredits: number | null
    planCredits?: number | null
    billingPeriodStart?: string | null
    billingPeriodEnd?: string | null
  }
}

export type FirecrawlResponse =
  | ScrapeResponse
  | SearchResponse
  | FirecrawlCrawlResponse
  | MapResponse
  | ExtractResponse
  | AgentResponse
  | ParseResponse
  | FirecrawlCrawlStatusResponse
  | FirecrawlCancelCrawlResponse
  | FirecrawlBatchScrapeResponse
  | FirecrawlBatchScrapeStatusResponse
  | FirecrawlExtractStatusResponse
  | FirecrawlCreditUsageResponse
