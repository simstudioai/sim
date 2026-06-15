import type { ToolFileData, ToolResponse } from '@/tools/types'

/** Credit accounting fields surfaced on every Context.dev tool output. */
interface CreditFields {
  creditsConsumed: number | null
  creditsRemaining: number | null
}

export interface ContextDevScrapeMarkdownParams {
  apiKey: string
  url: string
  useMainContentOnly?: boolean
  includeLinks?: boolean
  includeImages?: boolean
  includeFrames?: boolean
  maxAgeMs?: number
  waitForMs?: number
  timeoutMS?: number
}

export interface ContextDevScrapeMarkdownResponse extends ToolResponse {
  output: CreditFields & {
    markdown: string
    url: string
  }
}

export interface ContextDevScrapeHtmlParams {
  apiKey: string
  url: string
  useMainContentOnly?: boolean
  includeFrames?: boolean
  maxAgeMs?: number
  waitForMs?: number
  timeoutMS?: number
}

export interface ContextDevScrapeHtmlResponse extends ToolResponse {
  output: CreditFields & {
    html: string
    url: string
    type: string
  }
}

export interface ContextDevScreenshotParams {
  apiKey: string
  url: string
  fullScreenshot?: boolean
  handleCookiePopup?: boolean
  viewportWidth?: number
  viewportHeight?: number
  maxAgeMs?: number
  waitForMs?: number
  timeoutMS?: number
}

export interface ContextDevScreenshotResponse extends ToolResponse {
  output: CreditFields & {
    file?: ToolFileData
    screenshotUrl: string
    screenshotType: string | null
    domain: string | null
    width: number | null
    height: number | null
  }
}

export interface ContextDevCrawlParams {
  apiKey: string
  url: string
  maxPages?: number
  maxDepth?: number
  urlRegex?: string
  includeLinks?: boolean
  includeImages?: boolean
  useMainContentOnly?: boolean
  followSubdomains?: boolean
  maxAgeMs?: number
  waitForMs?: number
  stopAfterMs?: number
  timeoutMS?: number
}

export interface ContextDevCrawlResponse extends ToolResponse {
  output: CreditFields & {
    results: Array<{
      markdown: string
      metadata: Record<string, unknown>
    }>
    metadata: Record<string, unknown>
  }
}

export interface ContextDevMapParams {
  apiKey: string
  domain: string
  maxLinks?: number
  urlRegex?: string
  timeoutMS?: number
}

export interface ContextDevMapResponse extends ToolResponse {
  output: CreditFields & {
    domain: string
    urls: string[]
    meta: Record<string, unknown>
  }
}

export interface ContextDevSearchParams {
  apiKey: string
  query: string
  includeDomains?: string[]
  excludeDomains?: string[]
  freshness?: string
  queryFanout?: boolean
  markdownEnabled?: boolean
  timeoutMS?: number
}

export interface ContextDevSearchResponse extends ToolResponse {
  output: CreditFields & {
    results: Array<Record<string, unknown>>
    query: string
  }
}

export interface ContextDevExtractParams {
  apiKey: string
  url: string
  schema: Record<string, unknown>
  instructions?: string
  factCheck?: boolean
  followSubdomains?: boolean
  maxPages?: number
  maxDepth?: number
  maxAgeMs?: number
  stopAfterMs?: number
  timeoutMS?: number
}

export interface ContextDevExtractResponse extends ToolResponse {
  output: CreditFields & {
    status: string
    url: string
    urlsAnalyzed: string[]
    data: Record<string, unknown>
    metadata: Record<string, unknown>
  }
}

export interface ContextDevClassifyNaicsParams {
  apiKey: string
  input: string
  minResults?: number
  maxResults?: number
  timeoutMS?: number
}

export interface ContextDevClassifyNaicsResponse extends ToolResponse {
  output: CreditFields & {
    status: string
    domain: string | null
    type: string | null
    codes: Array<Record<string, unknown>>
  }
}

export interface ContextDevClassifySicParams {
  apiKey: string
  input: string
  type?: string
  minResults?: number
  maxResults?: number
  timeoutMS?: number
}

export interface ContextDevClassifySicResponse extends ToolResponse {
  output: CreditFields & {
    status: string
    domain: string | null
    type: string | null
    classification: string | null
    codes: Array<Record<string, unknown>>
  }
}

export interface ContextDevGetBrandParams {
  apiKey: string
  domain: string
  forceLanguage?: string
  maxSpeed?: boolean
  maxAgeMs?: number
  timeoutMS?: number
}

export interface ContextDevGetBrandResponse extends ToolResponse {
  output: CreditFields & {
    status: string
    brand: Record<string, unknown> | null
  }
}

/** Output schema for a single web search result. */
export const SEARCH_RESULT_OUTPUT_PROPERTIES = {
  url: { type: 'string', description: 'Result page URL' },
  title: { type: 'string', description: 'Result page title' },
  description: { type: 'string', description: 'Result snippet/description' },
  relevance: { type: 'string', description: 'Relevance rating (high, medium, low)' },
  markdown: {
    type: 'json',
    description: 'Scraped markdown for the result (when markdown scraping is enabled)',
  },
} as const

/** Output schema for a single crawled page. */
export const CRAWL_RESULT_OUTPUT_PROPERTIES = {
  markdown: { type: 'string', description: 'Page content as markdown' },
  metadata: { type: 'json', description: 'Page metadata (url, title, crawlDepth, statusCode)' },
} as const

/** Output schema for a single industry classification code. */
export const CLASSIFICATION_CODE_OUTPUT_PROPERTIES = {
  code: { type: 'string', description: 'Industry code' },
  name: { type: 'string', description: 'Industry name' },
  confidence: { type: 'string', description: 'Match confidence (high, medium, low)' },
} as const
