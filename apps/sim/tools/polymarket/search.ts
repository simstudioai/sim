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
      description: 'Number of results per page (max 50)',
    },
    offset: {
      type: 'string',
      required: false,
      description: 'Pagination offset',
    },
  },

  request: {
    url: (params) => {
      const queryParams = new URLSearchParams()
      queryParams.append('q', params.query)
      // Default limit to 50 to prevent browser crashes from large data sets
      queryParams.append('limit', params.limit || '50')
      if (params.offset) queryParams.append('offset', params.offset)

      return `${buildGammaUrl('/public-search')}?${queryParams.toString()}`
    },
    method: 'GET',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
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
      },
    }
  },

  outputs: {
    results: {
      type: 'object',
      description: 'Search results containing markets, events, and profiles arrays',
    },
  },
}
