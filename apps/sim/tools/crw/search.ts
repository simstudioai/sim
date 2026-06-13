import { resolveCrwBaseUrl } from '@/tools/crw/base-url'
import type { SearchParams, SearchResponse } from '@/tools/crw/types'
import { SEARCH_RESULT_OUTPUT_PROPERTIES } from '@/tools/crw/types'
import type { ToolConfig } from '@/tools/types'

export const searchTool: ToolConfig<SearchParams, SearchResponse> = {
  id: 'crw_search',
  name: 'fastCRW Search',
  description: 'Search for information on the web using fastCRW',
  version: '1.0.0',

  params: {
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The search query to use',
    },
    baseUrl: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Base URL for self-hosted fastCRW (defaults to https://fastcrw.com/api)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'fastCRW API key',
    },
  },

  hosting: {
    envKeyPrefix: 'CRW_API_KEY',
    apiKeyParam: 'apiKey',
    byokProviderId: 'crw',
    // fastCRW is BYOK-only — Sim does not meter usage.
    pricing: { type: 'per_request', cost: 0 },
    rateLimit: {
      mode: 'per_request',
      requestsPerMinute: 100,
    },
  },

  request: {
    method: 'POST',
    url: (params) => `${resolveCrwBaseUrl(params.baseUrl)}/v1/search`,
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
      if (params.scrapeOptions) body.scrapeOptions = params.scrapeOptions

      return body
    },
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    return {
      success: data.success !== false,
      error: data.success === false ? data.error || 'fastCRW search failed' : undefined,
      output: {
        data: data.data,
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
