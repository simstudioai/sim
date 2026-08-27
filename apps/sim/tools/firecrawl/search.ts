import { firecrawlHosting } from '@/tools/firecrawl/hosting'
import {
  applyFirecrawlScrapeOptionsModelInput,
  selectFirecrawlScrapeOptionsModelInput,
} from '@/tools/firecrawl/model-input'
import type { FirecrawlSearchData, SearchParams, SearchResponse } from '@/tools/firecrawl/types'
import { SEARCH_DATA_OUTPUT } from '@/tools/firecrawl/types'
import { finiteNumber } from '@/tools/firecrawl/utils'
import type { ToolConfig } from '@/tools/types'

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
      description:
        'Maximum number of results to return per source type, not in total (Firecrawl default: 10, maximum: 100). Requesting three sources at limit 100 can return up to 300 results.',
    },
    sources: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Result sources to search: "web", "news", and/or "images". Defaults to ["web"]. Each requested source is returned as its own array under `data` — `data.web`, `data.news`, `data.images` — with its own item fields.',
      items: { anyOf: [{ const: 'web' }, { const: 'news' }, { const: 'images' }] },
    },
    categories: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Restrict web results to these categories: "github", "research", "pdf", or "developer". "developer" cannot be combined with any other category.',
      items: {
        anyOf: [
          { const: 'github' },
          { const: 'research' },
          { const: 'pdf' },
          { const: 'developer' },
        ],
      },
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
      description:
        'ISO country code for geo-targeting results (e.g. "US", "DE", "JP"). Firecrawl defaults to "US" when this is unset, and recommends setting `location` alongside it for best results.',
    },
    firecrawlTimeout: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        "How long Firecrawl may spend on the search, in milliseconds (Firecrawl default: 60000). Sent as `timeout` in the request body; it does not bound Sim's own transport deadline.",
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
      const limit = finiteNumber(params.limit)
      if (limit !== undefined) body.limit = limit
      if (params.sources) body.sources = params.sources
      if (params.categories) body.categories = params.categories
      if (params.tbs) body.tbs = params.tbs
      if (params.location) body.location = params.location
      if (params.country) body.country = params.country
      const firecrawlTimeout = finiteNumber(params.firecrawlTimeout)
      if (firecrawlTimeout !== undefined) body.timeout = firecrawlTimeout
      if (typeof params.ignoreInvalidURLs === 'boolean')
        body.ignoreInvalidURLs = params.ignoreInvalidURLs
      if (params.scrapeOptions) body.scrapeOptions = params.scrapeOptions

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const payload = await response.json()
    const data = payload?.data

    return {
      success: true,
      output: {
        data:
          data && typeof data === 'object' && !Array.isArray(data)
            ? (data as FirecrawlSearchData)
            : {},
        warning: payload?.warning ?? undefined,
        id: payload?.id,
        creditsUsed: payload?.creditsUsed,
      },
    }
  },

  outputs: {
    data: SEARCH_DATA_OUTPUT,
    warning: {
      type: 'string',
      description: 'Warning message if any issues occurred during the search',
      optional: true,
    },
    id: { type: 'string', description: 'ID of the search job', optional: true },
    creditsUsed: {
      type: 'number',
      description: 'Number of credits the search consumed',
      optional: true,
    },
  },
}
