import { firecrawlHosting } from '@/tools/firecrawl/hosting'
import {
  applyFirecrawlScrapeOptionsModelInput,
  selectFirecrawlScrapeOptionsModelInput,
} from '@/tools/firecrawl/model-input'
import type { SearchParams, SearchResponse, SearchResultItem } from '@/tools/firecrawl/types'
import { SEARCH_RESULT_OUTPUT_PROPERTIES } from '@/tools/firecrawl/types'
import type { ToolConfig } from '@/tools/types'

/**
 * Source keys Firecrawl documents for `POST /v2/search`, in the order their
 * results are concatenated. Listing them explicitly — rather than relying on
 * object key order — keeps the flattened output stable no matter what order
 * the API happens to serialize the envelope in.
 */
const FIRECRAWL_SEARCH_SOURCE_ORDER = ['web', 'news', 'images'] as const

/**
 * Flattens the source-keyed search envelope into the single result array this
 * tool declares.
 *
 * Firecrawl returns `data` keyed by source ("The arrays available will depend
 * on the sources you specified in the request. By default, the `web` array
 * will be returned."), so `data.data` is `{ web: [...], news: [...], images:
 * [...] }` — not the array `outputs.data` advertises. Known sources come first
 * in {@link FIRECRAWL_SEARCH_SOURCE_ORDER}, then any future source key in
 * alphabetical order; a plain array is passed through unchanged, and anything
 * else yields `[]`.
 */
export const flattenFirecrawlSearchResults = (data: unknown): SearchResultItem[] => {
  if (Array.isArray(data)) return data as SearchResultItem[]
  if (data === null || typeof data !== 'object') return []

  const envelope = data as Record<string, unknown>
  const knownKeys = FIRECRAWL_SEARCH_SOURCE_ORDER as readonly string[]
  const extraKeys = Object.keys(envelope)
    .filter((key) => !knownKeys.includes(key))
    .sort()

  const flattened: SearchResultItem[] = []
  for (const key of [...knownKeys, ...extraKeys]) {
    const results = envelope[key]
    if (Array.isArray(results)) flattened.push(...(results as SearchResultItem[]))
  }
  return flattened
}

export const searchTool: ToolConfig<SearchParams, SearchResponse> = {
  id: 'firecrawl_search',
  name: 'Firecrawl Search',
  description: 'Search for information on the web using Firecrawl',
  version: '1.0.0',

  params: {
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The search query to use',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of results to return (Firecrawl default: 10)',
    },
    sources: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Result sources to search. Defaults to ["web"]. Results from every requested source are flattened into `data` in web, news, images order.',
      items: { type: 'string' },
    },
    categories: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Restrict web results to these categories: "github", "research", or "pdf"',
      items: { type: 'string' },
    },
    tbs: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Time-based search filter (e.g. "qdr:d" for the past day, "qdr:w" for the past week)',
    },
    location: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Location to search from (e.g. "Germany", "San Francisco, California")',
    },
    country: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Two-letter country code to search from (Firecrawl default: "US")',
    },
    timeout: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Request timeout in milliseconds (Firecrawl default: 60000)',
    },
    ignoreInvalidURLs: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Skip results whose URLs cannot be scraped instead of failing the search',
    },
    scrapeOptions: {
      type: 'json',
      required: false,
      visibility: 'hidden',
      description: 'Advanced scrape options supplied by existing configurations',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Firecrawl API key',
    },
  },

  hosting: firecrawlHosting(),

  request: {
    modelInput: {
      mode: 'project',
      select: (params) => ({
        scrapeOptions: selectFirecrawlScrapeOptionsModelInput(params.scrapeOptions),
      }),
      applyProjected: (selectedParams, projectedSelection) => ({
        scrapeOptions: applyFirecrawlScrapeOptionsModelInput(
          selectedParams.scrapeOptions,
          projectedSelection.scrapeOptions
        ),
      }),
    },
    method: 'POST',
    url: 'https://api.firecrawl.dev/v2/search',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
    body: (params) => {
      const body: Record<string, any> = {
        query: params.query,
      }

      // Add optional parameters if provided (truthy check filters empty strings, null, undefined)
      if (params.limit) body.limit = Number(params.limit)
      if (params.sources) body.sources = params.sources
      if (params.categories) body.categories = params.categories
      if (params.tbs) body.tbs = params.tbs
      if (params.location) body.location = params.location
      if (params.country) body.country = params.country
      if (params.timeout) body.timeout = Number(params.timeout)
      if (typeof params.ignoreInvalidURLs === 'boolean')
        body.ignoreInvalidURLs = params.ignoreInvalidURLs
      if (params.scrapeOptions) body.scrapeOptions = params.scrapeOptions

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        data: flattenFirecrawlSearchResults(data?.data),
        creditsUsed: data?.creditsUsed,
      },
    }
  },

  outputs: {
    data: {
      type: 'array',
      description: 'Search results data with scraped content and metadata',
      items: {
        type: 'object',
        properties: SEARCH_RESULT_OUTPUT_PROPERTIES,
      },
    },
  },
}
