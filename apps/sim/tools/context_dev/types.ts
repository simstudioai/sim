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

export interface ContextDevScrapeImagesParams {
  apiKey: string
  url: string
  maxAgeMs?: number
  waitForMs?: number
  timeoutMS?: number
  enrichResolution?: boolean
  enrichHostedUrl?: boolean
  enrichClassification?: boolean
}

export interface ContextDevScrapeImagesResponse extends ToolResponse {
  output: CreditFields & {
    success: boolean
    images: Array<Record<string, unknown>>
    url: string
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
  numResults?: number
  country?: string
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

export interface ContextDevExtractProductParams {
  apiKey: string
  url: string
  maxAgeMs?: number
  timeoutMS?: number
}

export interface ContextDevExtractProductResponse extends ToolResponse {
  output: CreditFields & {
    isProductPage: boolean
    platform: string | null
    product: Record<string, unknown> | null
  }
}

export interface ContextDevExtractProductsParams {
  apiKey: string
  domain: string
  maxProducts?: number
  maxAgeMs?: number
  timeoutMS?: number
}

export interface ContextDevExtractProductsResponse extends ToolResponse {
  output: CreditFields & {
    products: Array<Record<string, unknown>>
  }
}

export interface ContextDevScrapeFontsParams {
  apiKey: string
  domain: string
  maxAgeMs?: number
  timeoutMS?: number
}

export interface ContextDevScrapeFontsResponse extends ToolResponse {
  output: CreditFields & {
    status: string
    domain: string
    fonts: Array<Record<string, unknown>>
    fontLinks: Record<string, unknown>
  }
}

export interface ContextDevScrapeStyleguideParams {
  apiKey: string
  domain: string
  maxAgeMs?: number
  timeoutMS?: number
}

export interface ContextDevScrapeStyleguideResponse extends ToolResponse {
  output: CreditFields & {
    status: string
    domain: string
    styleguide: Record<string, unknown> | null
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

/** Shared response shape for every brand-returning endpoint (full brand object). */
export interface ContextDevBrandResponse extends ToolResponse {
  output: CreditFields & {
    status: string
    brand: Record<string, unknown> | null
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

export interface ContextDevGetBrandByNameParams {
  apiKey: string
  name: string
  countryGl?: string
  forceLanguage?: string
  maxSpeed?: boolean
  maxAgeMs?: number
  timeoutMS?: number
}

export interface ContextDevGetBrandByEmailParams {
  apiKey: string
  email: string
  forceLanguage?: string
  maxSpeed?: boolean
  maxAgeMs?: number
  timeoutMS?: number
}

export interface ContextDevGetBrandByTickerParams {
  apiKey: string
  ticker: string
  tickerExchange?: string
  forceLanguage?: string
  maxSpeed?: boolean
  maxAgeMs?: number
  timeoutMS?: number
}

export interface ContextDevIdentifyTransactionParams {
  apiKey: string
  transactionInfo: string
  countryGl?: string
  city?: string
  mcc?: string
  phone?: number
  highConfidenceOnly?: boolean
  forceLanguage?: string
  maxSpeed?: boolean
  timeoutMS?: number
}

export interface ContextDevGetBrandSimplifiedParams {
  apiKey: string
  domain: string
  maxAgeMs?: number
  timeoutMS?: number
}

export interface ContextDevGetBrandSimplifiedResponse extends ToolResponse {
  output: CreditFields & {
    status: string
    brand: Record<string, unknown> | null
  }
}

export interface ContextDevPrefetchByEmailParams {
  apiKey: string
  email: string
  timeoutMS?: number
}

export interface ContextDevPrefetchDomainParams {
  apiKey: string
  domain: string
  timeoutMS?: number
}

/** Shared response shape for the prefetch utility endpoints. */
export interface ContextDevPrefetchResponse extends ToolResponse {
  output: CreditFields & {
    status: string
    message: string
    domain: string
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

/** Output schema for the full brand object returned by brand-intelligence endpoints. */
export const BRAND_OUTPUT_PROPERTIES = {
  domain: { type: 'string', description: 'Brand domain' },
  title: { type: 'string', description: 'Brand title' },
  description: { type: 'string', description: 'Brand description' },
  slogan: { type: 'string', description: 'Brand slogan' },
  colors: { type: 'json', description: 'Brand colors (hex and name)' },
  logos: { type: 'json', description: 'Brand logos with mode, colors, resolution, and type' },
  backdrops: { type: 'json', description: 'Brand backdrop images' },
  socials: { type: 'json', description: 'Social media profiles (type and url)' },
  address: { type: 'json', description: 'Brand address' },
  stock: { type: 'json', description: 'Stock info (ticker and exchange)' },
  is_nsfw: { type: 'boolean', description: 'Whether the brand contains adult content' },
  email: { type: 'string', description: 'Brand contact email' },
  phone: { type: 'string', description: 'Brand contact phone' },
  industries: { type: 'json', description: 'Industry taxonomy (eic industry/subindustry pairs)' },
  links: {
    type: 'json',
    description: 'Key brand links (careers, privacy, terms, blog, pricing, contact)',
  },
  primary_language: { type: 'string', description: 'Primary language of the brand site' },
} as const

/** Output schema for the reduced brand object returned by the simplified endpoint. */
export const SIMPLIFIED_BRAND_OUTPUT_PROPERTIES = {
  domain: { type: 'string', description: 'Brand domain' },
  title: { type: 'string', description: 'Brand title' },
  colors: { type: 'json', description: 'Brand colors (hex and name)' },
  logos: { type: 'json', description: 'Brand logos with mode, colors, resolution, and type' },
  backdrops: { type: 'json', description: 'Brand backdrop images' },
} as const

/** Output schema for a single extracted product. */
export const PRODUCT_OUTPUT_PROPERTIES = {
  name: { type: 'string', description: 'Product name' },
  description: { type: 'string', description: 'Product description' },
  price: { type: 'number', description: 'Product price' },
  currency: { type: 'string', description: 'Price currency' },
  billing_frequency: {
    type: 'string',
    description: 'Billing frequency (monthly, yearly, one_time, usage_based)',
  },
  pricing_model: {
    type: 'string',
    description: 'Pricing model (per_seat, flat, tiered, freemium, custom)',
  },
  url: { type: 'string', description: 'Product URL' },
  category: { type: 'string', description: 'Product category' },
  features: { type: 'json', description: 'Product features' },
  target_audience: { type: 'json', description: 'Target audience' },
  tags: { type: 'json', description: 'Product tags' },
  image_url: { type: 'string', description: 'Primary product image URL' },
  images: { type: 'json', description: 'Product image URLs' },
  sku: { type: 'string', description: 'Product SKU' },
} as const

/** Output schema for a single font usage entry. */
export const FONT_OUTPUT_PROPERTIES = {
  font: { type: 'string', description: 'Font family name' },
  uses: { type: 'json', description: 'Where the font is used' },
  fallbacks: { type: 'json', description: 'Fallback font families' },
  num_elements: { type: 'number', description: 'Number of elements using the font' },
  num_words: { type: 'number', description: 'Number of words rendered in the font' },
  percent_words: { type: 'number', description: 'Percent of words using the font' },
  percent_elements: { type: 'number', description: 'Percent of elements using the font' },
} as const

/** Output schema for a single scraped image. */
export const IMAGE_OUTPUT_PROPERTIES = {
  src: { type: 'string', description: 'Image source URL or data' },
  element: {
    type: 'string',
    description: 'Source element (img, svg, link, source, video, css, object, meta, background)',
  },
  type: { type: 'string', description: 'Image representation (url, html, base64)' },
  alt: { type: 'string', description: 'Alt text', optional: true },
  enrichment: {
    type: 'json',
    description: 'Optional enrichment (width, height, mimetype, url, type) when requested',
  },
} as const
