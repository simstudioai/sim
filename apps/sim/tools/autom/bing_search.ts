import { toBooleanOrNull, toNumberOrNull } from '@sim/utils/coerce'
import { toArray, toRecord } from '@sim/utils/object'
import type {
  AutomBingSearchParams,
  AutomBingSearchResponse,
  AutomSearchResult,
} from '@/tools/autom/types'
import { AUTOM_SEARCH_RESULT_OUTPUT_PROPERTIES } from '@/tools/autom/types'
import { mapAutomSearchResult } from '@/tools/autom/utils'
import type { ToolConfig } from '@/tools/types'

export const automBingSearchTool: ToolConfig<AutomBingSearchParams, AutomBingSearchResponse> = {
  id: 'autom_bing_search',
  name: 'Autom Bing Search',
  description: 'Search Bing and get organic results with their position, title, link and snippet.',
  version: '1.0.0',

  params: {
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Search query (e.g., "best electric cars")',
    },
    market: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Bing market code (e.g., "en-US")',
    },
    page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page of results, starting at 1',
    },
    numResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results per page (e.g., 10)',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Autom API key',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(`https://api.autom.dev/v1/bing/search`)
      url.searchParams.set('query', params.query.trim())
      if (params.market?.trim()) url.searchParams.set('mkt', params.market.trim())
      if (params.page != null) url.searchParams.set('page', String(params.page))
      if (params.numResults != null) url.searchParams.set('num', String(params.numResults))
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      'x-api-key': params.apiKey,
      Accept: 'application/json',
    }),
  },

  transformResponse: async (response) => {
    const data = toRecord(await response.json())
    return {
      success: true,
      output: {
        results: toArray(data.organic_results)
          .map(mapAutomSearchResult)
          .filter((item): item is AutomSearchResult => item !== null),
        totalResults: toNumberOrNull(toRecord(data.search_information).total_results),
        hasNextPage: toBooleanOrNull(toRecord(data.pagination).has_next_page),
      },
    }
  },

  outputs: {
    results: {
      type: 'array',
      description: 'Organic results',
      optional: true,
      items: { type: 'object', properties: AUTOM_SEARCH_RESULT_OUTPUT_PROPERTIES },
    },
    totalResults: {
      type: 'number',
      description: 'Estimated total number of results',
      optional: true,
    },
    hasNextPage: {
      type: 'boolean',
      description: 'Whether another page of results exists',
      optional: true,
    },
  },
}
