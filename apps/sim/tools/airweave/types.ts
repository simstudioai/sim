import type { OutputProperty, ToolResponse } from '@/tools/types'

/**
 * Output definition for Airweave search result items.
 * Based on Airweave Search API response format.
 */
export const AIRWEAVE_SEARCH_RESULT_OUTPUT_PROPERTIES = {
  entity_id: { type: 'string', description: 'Unique identifier for the search result entity' },
  source_name: { type: 'string', description: 'Name of the data source (e.g., "GitHub", "Slack")' },
  md_content: {
    type: 'string',
    description: 'Markdown-formatted content of the result',
    optional: true,
  },
  score: { type: 'number', description: 'Relevance score from the search' },
  metadata: {
    type: 'object',
    description: 'Additional metadata associated with the result',
    optional: true,
  },
  breadcrumbs: {
    type: 'array',
    description: 'Navigation path to the result within its source',
    optional: true,
    items: { type: 'string', description: 'Breadcrumb segment' },
  },
  url: { type: 'string', description: 'URL to the original content', optional: true },
} as const satisfies Record<string, OutputProperty>

/**
 * Complete search result output definition.
 */
export const AIRWEAVE_SEARCH_RESULT_OUTPUT: OutputProperty = {
  type: 'object',
  description: 'Search result item with content and metadata',
  properties: AIRWEAVE_SEARCH_RESULT_OUTPUT_PROPERTIES,
}

/**
 * Parameters for Airweave search requests.
 */
export interface AirweaveSearchParams {
  /** Airweave API Key for authentication */
  apiKey: string
  /** The readable ID of the collection to search */
  collectionId: string
  /** The search query text */
  query: string
  /** Maximum number of results to return */
  limit?: number
  /** Retrieval strategy: hybrid, neural, or keyword */
  retrievalStrategy?: 'hybrid' | 'neural' | 'keyword'
  /** Generate query variations to improve recall */
  expandQuery?: boolean
  /** Reorder results for improved relevance using LLM */
  rerank?: boolean
  /** Generate a natural-language answer to the query */
  generateAnswer?: boolean
}

/**
 * Individual search result from Airweave.
 */
export interface AirweaveSearchResult {
  entity_id: string
  source_name: string
  md_content?: string
  score: number
  metadata?: Record<string, any>
  breadcrumbs?: string[]
  url?: string
}

/**
 * Response from Airweave search API.
 */
export interface AirweaveSearchResponse extends ToolResponse {
  output: {
    /** Array of search results */
    results: AirweaveSearchResult[]
    /** AI-generated answer to the query (when generateAnswer is true) */
    completion?: string
  }
}
