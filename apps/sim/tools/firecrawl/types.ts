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
    description:
      'The originally requested URL. Differs from `url` when the request was redirected.',
  },
  url: {
    type: 'string',
    description: 'The final URL of the page after all redirects were followed',
    optional: true,
  },
  statusCode: { type: 'number', description: 'HTTP status code', optional: true },
  error: {
    type: 'string',
    description: 'Error message if scrape failed',
    optional: true,
    nullable: true,
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete search metadata output definition
 */
/**
 * Present only on results Firecrawl actually scraped. An unscraped search hit carries no
 * `metadata` at all — the official SDK models those as bare `SearchResultWeb`/`SearchResultNews`,
 * and the v2 schema declares no required properties on either item.
 * @see https://github.com/firecrawl/firecrawl/blob/main/apps/js-sdk/firecrawl/src/v2/types.ts
 */
export const SEARCH_METADATA_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Metadata about the search result page; present only when the result was scraped',
  optional: true,
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
 * Output properties for web search result items.
 * Based on the `data.web[]` items of the `POST /v2/search` 200 response.
 * @see https://docs.firecrawl.dev/api-reference/v2-openapi.json
 */
export const SEARCH_WEB_RESULT_OUTPUT_PROPERTIES = {
  title: {
    type: 'string',
    description: 'Search result title from search engine',
    optional: true,
  },
  description: {
    type: 'string',
    description: 'Search result description/snippet from search engine',
    optional: true,
  },
  url: { type: 'string', description: 'URL of the search result' },
  position: { type: 'number', description: 'Position of the result', optional: true },
  markdown: {
    type: 'string',
    description:
      'Page content in markdown; returned only when scraping was requested via the hidden scrapeOptions input',
    optional: true,
    nullable: true,
  },
  html: {
    type: 'string',
    description:
      'Processed HTML content; returned only when "html" is among the scrape formats requested via the hidden scrapeOptions input',
    optional: true,
    nullable: true,
  },
  rawHtml: {
    type: 'string',
    description:
      'Unprocessed raw HTML; returned only when "rawHtml" is among the scrape formats requested via the hidden scrapeOptions input',
    optional: true,
    nullable: true,
  },
  links: {
    type: 'array',
    description:
      'Links found on the page; returned only when "links" is among the scrape formats requested via the hidden scrapeOptions input',
    optional: true,
    items: { type: 'string', description: 'URL found on the page' },
  },
  screenshot: {
    type: 'string',
    description:
      'Screenshot URL (expires after 24 hours); returned only when "screenshot" is among the scrape formats requested via the hidden scrapeOptions input',
    optional: true,
    nullable: true,
  },
  audio: {
    type: 'string',
    description:
      'Signed URL to the extracted MP3 audio (expires after 1 hour); returned only when "audio" is among the requested scrape formats',
    optional: true,
    nullable: true,
  },
  video: {
    type: 'string',
    description:
      'Signed URL to the extracted video (expires after 1 hour); returned only when "video" is among the requested scrape formats',
    optional: true,
    nullable: true,
  },
  category: {
    type: 'string',
    description: 'Category the result was matched under, when the request narrowed by category',
    optional: true,
  },
  metadata: SEARCH_METADATA_OUTPUT,
} as const satisfies Record<string, OutputProperty>

/**
 * Output properties for news search result items.
 * News items carry `snippet` — not the `description` web items use — plus `date` and `imageUrl`.
 * Based on the `data.news[]` items of the `POST /v2/search` 200 response.
 * @see https://docs.firecrawl.dev/api-reference/v2-openapi.json
 */
export const SEARCH_NEWS_RESULT_OUTPUT_PROPERTIES = {
  title: { type: 'string', description: 'Title of the article', optional: true },
  snippet: { type: 'string', description: 'Snippet from the article', optional: true },
  url: { type: 'string', description: 'URL of the article', optional: true },
  date: { type: 'string', description: 'Publication date of the article', optional: true },
  imageUrl: { type: 'string', description: 'Thumbnail image URL for the article', optional: true },
  position: { type: 'number', description: 'Position of the article', optional: true },
  markdown: {
    type: 'string',
    description:
      'Article content in markdown; returned only when scraping was requested via the hidden scrapeOptions input',
    optional: true,
    nullable: true,
  },
  html: {
    type: 'string',
    description:
      'Processed HTML content; returned only when "html" is among the requested scrape formats',
    optional: true,
    nullable: true,
  },
  rawHtml: {
    type: 'string',
    description:
      'Unprocessed raw HTML; returned only when "rawHtml" is among the requested scrape formats',
    optional: true,
    nullable: true,
  },
  links: {
    type: 'array',
    description: 'Links found on the article page; returned only when "links" was requested',
    optional: true,
    items: { type: 'string', description: 'URL found on the page' },
  },
  screenshot: {
    type: 'string',
    description: 'Screenshot URL (expires after 24 hours); returned only when requested',
    optional: true,
    nullable: true,
  },
  audio: {
    type: 'string',
    description:
      'Signed URL to the extracted MP3 audio (expires after 1 hour); returned only when "audio" is among the requested scrape formats',
    optional: true,
    nullable: true,
  },
  video: {
    type: 'string',
    description:
      'Signed URL to the extracted video (expires after 1 hour); returned only when "video" is among the requested scrape formats',
    optional: true,
    nullable: true,
  },
  category: {
    type: 'string',
    description: 'Category the article was matched under, when the request narrowed by category',
    optional: true,
  },
  metadata: SEARCH_METADATA_OUTPUT,
} as const satisfies Record<string, OutputProperty>

/**
 * Output properties for image search result items.
 * `url` is the page containing the image; the image itself is at `imageUrl`.
 * Based on the `data.images[]` items of the `POST /v2/search` 200 response.
 * @see https://docs.firecrawl.dev/api-reference/v2-openapi.json
 */
export const SEARCH_IMAGE_RESULT_OUTPUT_PROPERTIES = {
  title: { type: 'string', description: 'Title from the search result', optional: true },
  imageUrl: { type: 'string', description: 'Direct URL of the image', optional: true },
  imageWidth: { type: 'number', description: 'Image width in pixels', optional: true },
  imageHeight: { type: 'number', description: 'Image height in pixels', optional: true },
  url: {
    type: 'string',
    description: 'URL of the page containing the image',
    optional: true,
  },
  position: { type: 'number', description: 'Position of the result', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * The source-keyed `data` envelope `POST /v2/search` returns. Which arrays are present depends on
 * the requested `sources`; `web` is the default.
 * @see https://docs.firecrawl.dev/api-reference/v2-openapi.json
 */
export const SEARCH_DATA_OUTPUT_PROPERTIES = {
  web: {
    type: 'array',
    description: 'Web search results',
    optional: true,
    items: { type: 'object', properties: SEARCH_WEB_RESULT_OUTPUT_PROPERTIES },
  },
  news: {
    type: 'array',
    description: 'News search results (present only when "news" is among the requested sources)',
    optional: true,
    items: { type: 'object', properties: SEARCH_NEWS_RESULT_OUTPUT_PROPERTIES },
  },
  images: {
    type: 'array',
    description: 'Image search results (present only when "images" is among the requested sources)',
    optional: true,
    items: { type: 'object', properties: SEARCH_IMAGE_RESULT_OUTPUT_PROPERTIES },
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Output properties for the URLs `POST /v2/map` discovers. Each entry is an object with a required
 * `url`, not a bare URL string.
 * @see https://docs.firecrawl.dev/api-reference/v2-openapi.json
 */
export const MAP_LINK_OUTPUT_PROPERTIES = {
  url: { type: 'string', description: 'Discovered URL' },
  title: { type: 'string', description: 'Title of the page, when available', optional: true },
  description: {
    type: 'string',
    description: 'Description of the page, when available',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

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
  /**
   * Firecrawl's own map deadline, in milliseconds. Deliberately not named `timeout`:
   * `request-transport.ts` reads `params.timeout` as the outbound fetch deadline for every tool,
   * so that name would make the local abort fire at the same instant Firecrawl gives up.
   */
  mapTimeout?: number | string
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

interface SearchResultMetadata {
  title?: string
  description?: string
  sourceURL: string
  url?: string
  statusCode?: number
  error?: string | null
}

interface ScrapedSearchContent {
  markdown?: string | null
  html?: string | null
  rawHtml?: string | null
  links?: string[]
  screenshot?: string | null
  audio?: string | null
  video?: string | null
  metadata?: SearchResultMetadata
}

export interface SearchWebResult extends ScrapedSearchContent {
  title?: string
  description?: string
  url: string
  position?: number
  category?: string
}

export interface SearchNewsResult extends ScrapedSearchContent {
  title?: string
  snippet?: string
  url?: string
  date?: string
  imageUrl?: string
  position?: number
  category?: string
}

export interface SearchImageResult {
  title?: string
  imageUrl?: string
  imageWidth?: number
  imageHeight?: number
  url?: string
  position?: number
}

/**
 * `POST /v2/search` answers with a source-keyed envelope, not a flat array. Only the sources the
 * request asked for are present.
 * @see https://docs.firecrawl.dev/api-reference/v2-openapi.json
 */
export interface SearchData {
  web?: SearchWebResult[]
  news?: SearchNewsResult[]
  images?: SearchImageResult[]
}

export interface SearchResponse extends ToolResponse {
  output: {
    data: SearchData
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

/** One entry of the `links` array `POST /v2/map` returns. */
export interface MapLink {
  url: string
  title?: string
  description?: string
}

export interface MapResponse extends ToolResponse {
  output: {
    success: boolean
    links: MapLink[]
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
