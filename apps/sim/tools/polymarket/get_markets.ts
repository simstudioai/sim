import type { ToolConfig } from '@/tools/types'
import type { PolymarketMarket, PolymarketPaginationParams } from './types'
import { buildGammaUrl, handlePolymarketError } from './types'

export interface PolymarketGetMarketsParams extends PolymarketPaginationParams {
  closed?: string // 'true' or 'false' - filter for closed/active markets
  order?: string // sort field (e.g., 'id', 'volume', 'liquidity')
  ascending?: string // 'true' or 'false' - sort direction
  tagId?: string // filter by tag ID
}

export interface PolymarketGetMarketsResponse {
  success: boolean
  output: {
    markets: PolymarketMarket[]
    metadata: {
      operation: 'get_markets'
      totalReturned: number
    }
    success: boolean
  }
}

export const polymarketGetMarketsTool: ToolConfig<
  PolymarketGetMarketsParams,
  PolymarketGetMarketsResponse
> = {
  id: 'polymarket_get_markets',
  name: 'Get Markets from Polymarket',
  description: 'Retrieve a list of prediction markets from Polymarket with optional filtering',
  version: '1.0.0',

  params: {
    closed: {
      type: 'string',
      required: false,
      description: 'Filter by closed status (true/false). Use false for active markets only.',
    },
    order: {
      type: 'string',
      required: false,
      description: 'Sort field (e.g., id, volume, liquidity)',
    },
    ascending: {
      type: 'string',
      required: false,
      description: 'Sort direction (true for ascending, false for descending)',
    },
    tagId: {
      type: 'string',
      required: false,
      description: 'Filter by tag ID',
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
      if (params.closed) queryParams.append('closed', params.closed)
      if (params.order) queryParams.append('order', params.order)
      if (params.ascending) queryParams.append('ascending', params.ascending)
      if (params.tagId) queryParams.append('tag_id', params.tagId)
      if (params.limit) queryParams.append('limit', params.limit)
      if (params.offset) queryParams.append('offset', params.offset)

      const query = queryParams.toString()
      const url = buildGammaUrl('/markets')
      return query ? `${url}?${query}` : url
    },
    method: 'GET',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      handlePolymarketError(data, response.status, 'get_markets')
    }

    // Response is an array of markets
    const markets = Array.isArray(data) ? data : []

    return {
      success: true,
      output: {
        markets,
        metadata: {
          operation: 'get_markets' as const,
          totalReturned: markets.length,
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Markets data and metadata',
      properties: {
        markets: { type: 'array', description: 'Array of market objects' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
