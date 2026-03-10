import type { SearchParams, SearchResponse } from '@/tools/firecrawl/types'
import { SEARCH_RESULT_OUTPUT_PROPERTIES } from '@/tools/firecrawl/types'
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
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Firecrawl API key',
    },
  },

  hosting: {
    envKeyPrefix: 'FIRECRAWL_API_KEY',
    apiKeyParam: 'apiKey',
    byokProviderId: 'firecrawl',
    pricing: {
      type: 'custom',
      getCost: (_params, output) => {
        if (output.creditsUsed == null) {
          throw new Error('Firecrawl response missing creditsUsed field')
        }

        const creditsUsed = Number(output.creditsUsed)
        if (Number.isNaN(creditsUsed)) {
          throw new Error('Firecrawl response returned a non-numeric creditsUsed field')
        }

        return {
          cost: creditsUsed * 0.001,
          metadata: { creditsUsed },
        }
      },
    },
    rateLimit: {
      mode: 'per_request',
      requestsPerMinute: 100,
    },
  },

  request: {
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
        data: data.data,
        creditsUsed: data.creditsUsed,
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
