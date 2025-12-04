import type { ToolConfig } from '@/tools/types'
import type { PolymarketPaginationParams, PolymarketSearchResult } from './types'
import { buildGammaUrl, handlePolymarketError } from './types'

export interface PolymarketSearchParams extends PolymarketPaginationParams {
  query: string // Search term (required)
}

export interface PolymarketSearchResponse {
  success: boolean
  output: {
    results: PolymarketSearchResult
    metadata: {
      operation: 'search'
      query: string
    }
    success: boolean
  }
}

export const polymarketSearchTool: ToolConfig<PolymarketSearchParams, PolymarketSearchResponse> = {
  id: 'polymarket_search',
  name: 'Search Polymarket',
  description: 'Search for markets, events, and profiles on Polymarket',
  version: '1.0.0',

  params: {
    query: {
      type: 'string',
      required: true,
      description: 'Search query term',
    },
    limit: {
      type: 'string',
      required: false,
      description: 'Number of results per page (recommended: 25-50)',
    },
    offset: {
      type: 'string',
      required: false,
      description: 'Pagination offset (skip this many results)',
    },
  },

  request: {
    url: (params) => {
      const queryParams = new URLSearchParams()
      queryParams.append('query', params.query)
      if (params.limit) queryParams.append('limit', params.limit)
      if (params.offset) queryParams.append('offset', params.offset)

      return `${buildGammaUrl('/public-search')}?${queryParams.toString()}`
    },
    method: 'GET',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response, params) => {
    const data = await response.json()

    if (!response.ok) {
      handlePolymarketError(data, response.status, 'search')
    }

    // Response contains markets, events, and profiles arrays
    const results: PolymarketSearchResult = {
      markets: data.markets || [],
      events: data.events || [],
      profiles: data.profiles || [],
    }

    return {
      success: true,
      output: {
        results,
        metadata: {
          operation: 'search' as const,
          query: params?.query || '',
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Search results and metadata',
      properties: {
        results: { type: 'object', description: 'Search results (markets, events, profiles)' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
