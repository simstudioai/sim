import type { SearchParams, SearchResponse } from '@/tools/firecrawl/types'
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
      description: 'Maximum number of results to return (1-100, default: 5)',
    },
    sources: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search sources: ["web"], ["images"], or ["news"] (default: ["web"])',
    },
    categories: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by categories: ["github"], ["research"], or ["pdf"]',
    },
    tbs: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'Time-based search: qdr:h (hour), qdr:d (day), qdr:w (week), qdr:m (month), qdr:y (year)',
    },
    location: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'Geographic location for results (e.g., "San Francisco, California, United States")',
    },
    country: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'ISO country code for geo-targeting (default: US)',
    },
    timeout: {
      type: 'number',
      required: false,
      visibility: 'user-only',
      description: 'Timeout in milliseconds (default: 60000)',
    },
    ignoreInvalidURLs: {
      type: 'boolean',
      required: false,
      visibility: 'hidden',
      description: 'Exclude invalid URLs from results (default: false)',
    },
    scrapeOptions: {
      type: 'json',
      required: false,
      visibility: 'hidden',
      description: 'Advanced scraping configuration for search results',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Firecrawl API key',
    },
  },

  request: {
    method: 'POST',
    url: 'https://api.firecrawl.dev/v1/search',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
    body: (params) => {
      const body: Record<string, any> = {
        query: params.query,
      }

      // Add all optional parameters if provided
      if (params.limit !== undefined) body.limit = Number(params.limit)
      if (params.sources !== undefined) body.sources = params.sources
      if (params.categories !== undefined) body.categories = params.categories
      if (params.tbs !== undefined) body.tbs = params.tbs
      if (params.location !== undefined) body.location = params.location
      if (params.country !== undefined) body.country = params.country
      if (params.timeout !== undefined) body.timeout = Number(params.timeout)
      if (params.ignoreInvalidURLs !== undefined) body.ignoreInvalidURLs = params.ignoreInvalidURLs
      if (params.scrapeOptions !== undefined) body.scrapeOptions = params.scrapeOptions

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        data: data.data,
        warning: data.warning,
      },
    }
  },

  outputs: {
    data: {
      type: 'array',
      description: 'Search results data',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          url: { type: 'string' },
          markdown: { type: 'string' },
          html: { type: 'string' },
          rawHtml: { type: 'string' },
          links: { type: 'array' },
          screenshot: { type: 'string' },
          metadata: { type: 'object' },
        },
      },
    },
    warning: { type: 'string', description: 'Warning messages from the search operation' },
  },
}
