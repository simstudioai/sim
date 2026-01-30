// Common types for Wikipedia tools
import type { OutputProperty, ToolResponse } from '@/tools/types'

/**
 * Shared output property definitions for Wikipedia API responses.
 * Based on MediaWiki REST API documentation: https://www.mediawiki.org/wiki/API:REST_API/Reference
 */

/**
 * Output definition for thumbnail image objects
 */
export const WIKIPEDIA_THUMBNAIL_OUTPUT_PROPERTIES = {
  source: { type: 'string', description: 'Thumbnail image URL' },
  width: { type: 'number', description: 'Thumbnail width in pixels' },
  height: { type: 'number', description: 'Thumbnail height in pixels' },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete thumbnail output definition
 */
export const WIKIPEDIA_THUMBNAIL_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Thumbnail image data',
  optional: true,
  properties: WIKIPEDIA_THUMBNAIL_OUTPUT_PROPERTIES,
}

/**
 * Output definition for content URL objects (desktop/mobile)
 */
export const WIKIPEDIA_CONTENT_URL_OUTPUT_PROPERTIES = {
  page: { type: 'string', description: 'Page URL' },
  revisions: { type: 'string', description: 'Revisions URL', optional: true },
  edit: { type: 'string', description: 'Edit URL', optional: true },
  talk: { type: 'string', description: 'Talk page URL', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete content URLs output definition
 */
export const WIKIPEDIA_CONTENT_URLS_OUTPUT_PROPERTIES = {
  desktop: {
    type: 'object',
    description: 'Desktop URLs',
    properties: WIKIPEDIA_CONTENT_URL_OUTPUT_PROPERTIES,
  },
  mobile: {
    type: 'object',
    description: 'Mobile URLs',
    properties: WIKIPEDIA_CONTENT_URL_OUTPUT_PROPERTIES,
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete content URLs output definition
 */
export const WIKIPEDIA_CONTENT_URLS_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'URLs to access the page',
  properties: WIKIPEDIA_CONTENT_URLS_OUTPUT_PROPERTIES,
}

/**
 * Output definition for page summary objects
 */
export const WIKIPEDIA_PAGE_SUMMARY_OUTPUT_PROPERTIES = {
  type: { type: 'string', description: 'Page type (standard, disambiguation, etc.)' },
  title: { type: 'string', description: 'Page title' },
  displaytitle: { type: 'string', description: 'Display title with formatting' },
  description: { type: 'string', description: 'Short page description', optional: true },
  extract: { type: 'string', description: 'Page extract/summary text' },
  extract_html: { type: 'string', description: 'Extract in HTML format', optional: true },
  thumbnail: WIKIPEDIA_THUMBNAIL_OUTPUT,
  originalimage: {
    type: 'object',
    description: 'Original image data',
    optional: true,
    properties: WIKIPEDIA_THUMBNAIL_OUTPUT_PROPERTIES,
  },
  content_urls: WIKIPEDIA_CONTENT_URLS_OUTPUT,
  lang: { type: 'string', description: 'Page language code' },
  dir: { type: 'string', description: 'Text direction (ltr or rtl)' },
  timestamp: { type: 'string', description: 'Last modification timestamp' },
  pageid: { type: 'number', description: 'Wikipedia page ID' },
  wikibase_item: { type: 'string', description: 'Wikidata item ID', optional: true },
  coordinates: {
    type: 'object',
    description: 'Geographic coordinates',
    optional: true,
    properties: {
      lat: { type: 'number', description: 'Latitude' },
      lon: { type: 'number', description: 'Longitude' },
    },
  },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete page summary output definition
 */
export const WIKIPEDIA_PAGE_SUMMARY_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Wikipedia page summary and metadata',
  properties: WIKIPEDIA_PAGE_SUMMARY_OUTPUT_PROPERTIES,
}

/**
 * Output definition for search result items
 */
export const WIKIPEDIA_SEARCH_RESULT_OUTPUT_PROPERTIES = {
  id: { type: 'number', description: 'Result index' },
  key: { type: 'string', description: 'URL-friendly page key' },
  title: { type: 'string', description: 'Page title' },
  excerpt: { type: 'string', description: 'Search result excerpt' },
  matched_title: { type: 'string', description: 'Matched title variant', optional: true },
  description: { type: 'string', description: 'Page description', optional: true },
  thumbnail: {
    type: 'object',
    description: 'Thumbnail data',
    optional: true,
    properties: {
      mimetype: { type: 'string', description: 'Image MIME type' },
      size: { type: 'number', description: 'File size in bytes', optional: true },
      width: { type: 'number', description: 'Width in pixels' },
      height: { type: 'number', description: 'Height in pixels' },
      duration: { type: 'number', description: 'Duration for video', optional: true },
      url: { type: 'string', description: 'Thumbnail URL' },
    },
  },
  url: { type: 'string', description: 'Page URL' },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete search result output definition
 */
export const WIKIPEDIA_SEARCH_RESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Wikipedia search result',
  properties: WIKIPEDIA_SEARCH_RESULT_OUTPUT_PROPERTIES,
}

/**
 * Output definition for page content objects
 */
export const WIKIPEDIA_PAGE_CONTENT_OUTPUT_PROPERTIES = {
  title: { type: 'string', description: 'Page title' },
  pageid: { type: 'number', description: 'Wikipedia page ID' },
  html: { type: 'string', description: 'Full HTML content of the page' },
  revision: { type: 'number', description: 'Page revision number' },
  tid: { type: 'string', description: 'Transaction ID (ETag)' },
  timestamp: { type: 'string', description: 'Last modified timestamp' },
  content_model: { type: 'string', description: 'Content model (wikitext)' },
  content_format: { type: 'string', description: 'Content format (text/html)' },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete page content output definition
 */
export const WIKIPEDIA_PAGE_CONTENT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Full HTML content and metadata of the Wikipedia page',
  properties: WIKIPEDIA_PAGE_CONTENT_OUTPUT_PROPERTIES,
}

/**
 * Output definition for random page objects (subset of summary)
 */
export const WIKIPEDIA_RANDOM_PAGE_OUTPUT_PROPERTIES = {
  type: { type: 'string', description: 'Page type' },
  title: { type: 'string', description: 'Page title' },
  displaytitle: { type: 'string', description: 'Display title' },
  description: { type: 'string', description: 'Page description', optional: true },
  extract: { type: 'string', description: 'Page extract/summary' },
  thumbnail: WIKIPEDIA_THUMBNAIL_OUTPUT,
  content_urls: {
    type: 'object',
    description: 'URLs to access the page',
    properties: {
      desktop: {
        type: 'object',
        description: 'Desktop URL',
        properties: { page: { type: 'string', description: 'Page URL' } },
      },
      mobile: {
        type: 'object',
        description: 'Mobile URL',
        properties: { page: { type: 'string', description: 'Page URL' } },
      },
    },
  },
  lang: { type: 'string', description: 'Language code' },
  timestamp: { type: 'string', description: 'Timestamp' },
  pageid: { type: 'number', description: 'Page ID' },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete random page output definition
 */
export const WIKIPEDIA_RANDOM_PAGE_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Random Wikipedia page data',
  properties: WIKIPEDIA_RANDOM_PAGE_OUTPUT_PROPERTIES,
}

// Page Summary tool types
export interface WikipediaPageSummaryParams {
  pageTitle: string
}

export interface WikipediaPageSummary {
  type: string
  title: string
  displaytitle: string
  description?: string
  extract: string
  extract_html?: string
  thumbnail?: {
    source: string
    width: number
    height: number
  }
  originalimage?: {
    source: string
    width: number
    height: number
  }
  content_urls: {
    desktop: {
      page: string
      revisions: string
      edit: string
      talk: string
    }
    mobile: {
      page: string
      revisions: string
      edit: string
      talk: string
    }
  }
  lang: string
  dir: string
  timestamp: string
  pageid: number
  wikibase_item?: string
  coordinates?: {
    lat: number
    lon: number
  }
}

export interface WikipediaPageSummaryResponse extends ToolResponse {
  output: {
    summary: WikipediaPageSummary
  }
}

// Search Pages tool types
export interface WikipediaSearchParams {
  query: string
  searchLimit?: number
}

export interface WikipediaSearchResult {
  id: number
  key: string
  title: string
  excerpt: string
  matched_title?: string
  description?: string
  thumbnail?: {
    mimetype: string
    size?: number
    width: number
    height: number
    duration?: number
    url: string
  }
  url: string
}

export interface WikipediaSearchResponse extends ToolResponse {
  output: {
    searchResults: WikipediaSearchResult[]
    totalHits: number
    query: string
  }
}

// Get Page Content tool types
export interface WikipediaPageContentParams {
  pageTitle: string
}

export interface WikipediaPageContent {
  title: string
  pageid: number
  html: string
  revision: number
  tid: string
  timestamp: string
  content_model: string
  content_format: string
}

export interface WikipediaPageContentResponse extends ToolResponse {
  output: {
    content: WikipediaPageContent
  }
}

// Random Page tool types
export interface WikipediaRandomPage {
  type: string
  title: string
  displaytitle: string
  description?: string
  extract: string
  thumbnail?: {
    source: string
    width: number
    height: number
  }
  content_urls: {
    desktop: {
      page: string
    }
    mobile: {
      page: string
    }
  }
  lang: string
  timestamp: string
  pageid: number
}

export interface WikipediaRandomPageResponse extends ToolResponse {
  output: {
    randomPage: WikipediaRandomPage
  }
}

export type WikipediaResponse =
  | WikipediaPageSummaryResponse
  | WikipediaSearchResponse
  | WikipediaPageContentResponse
  | WikipediaRandomPageResponse
