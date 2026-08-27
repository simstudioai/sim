import { tinyfishSearchHosting } from '@/tools/tinyfish/hosting'
import type {
  TinyFishRawSearch,
  TinyFishSearchParams,
  TinyFishSearchResponse,
} from '@/tools/tinyfish/types'
import {
  TINYFISH_SEARCH_API_BASE,
  tinyfishErrorMessage,
  tinyfishHeaders,
} from '@/tools/tinyfish/utils'
import type { ToolConfig } from '@/tools/types'

export const searchTool: ToolConfig<TinyFishSearchParams, TinyFishSearchResponse> = {
  id: 'tinyfish_search',
  name: 'TinyFish Search',
  description:
    'Search the web with TinyFish and get ranked results with titles, snippets, and URLs',
  version: '1.0.0',

  params: {
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Search query',
    },
    location: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Country code for geo-targeted results, such as US',
    },
    language: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Language code for the results, such as en',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'TinyFish API key',
    },
  },

  hosting: tinyfishSearchHosting(),

  request: {
    url: (params) => {
      const query = new URLSearchParams({ query: params.query })
      if (params.location) query.set('location', params.location)
      if (params.language) query.set('language', params.language)
      return `${TINYFISH_SEARCH_API_BASE}/?${query.toString()}`
    },
    method: 'GET',
    headers: (params) => tinyfishHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      throw new Error(await tinyfishErrorMessage(response))
    }

    const data = (await response.json()) as TinyFishRawSearch

    return {
      success: true,
      output: {
        query: data.query ?? '',
        results: (data.results ?? []).map((result) => ({
          position: result?.position ?? 0,
          siteName: result?.site_name ?? '',
          snippet: result?.snippet ?? '',
          title: result?.title ?? '',
          url: result?.url ?? '',
        })),
        totalResults: data.total_results ?? 0,
      },
    }
  },

  outputs: {
    query: { type: 'string', description: 'Query that was executed' },
    results: {
      type: 'array',
      description: 'Ranked search results',
      items: {
        type: 'object',
        properties: {
          position: { type: 'number', description: 'Rank in the result list' },
          siteName: { type: 'string', description: 'Site the result came from' },
          snippet: { type: 'string', description: 'Text snippet from the page' },
          title: { type: 'string', description: 'Page title' },
          url: { type: 'string', description: 'Result URL' },
        },
      },
    },
    totalResults: { type: 'number', description: 'Number of results returned' },
  },
}
