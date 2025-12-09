import type { ToolConfig } from '@/tools/types'
import type { PolymarketPaginationParams, PolymarketTrade } from './types'
import { buildDataUrl, handlePolymarketError } from './types'

export interface PolymarketGetTradesParams extends PolymarketPaginationParams {
  user?: string // Optional user wallet address
  market?: string // Optional market filter
}

export interface PolymarketGetTradesResponse {
  success: boolean
  output: {
    trades: PolymarketTrade[]
  }
}

export const polymarketGetTradesTool: ToolConfig<
  PolymarketGetTradesParams,
  PolymarketGetTradesResponse
> = {
  id: 'polymarket_get_trades',
  name: 'Get Trades from Polymarket',
  description: 'Retrieve trade history from Polymarket',
  version: '1.0.0',

  params: {
    user: {
      type: 'string',
      required: false,
      description: 'User wallet address to filter trades',
    },
    market: {
      type: 'string',
      required: false,
      description: 'Market ID to filter trades',
    },
    limit: {
      type: 'string',
      required: false,
      description: 'Number of results per page (max 50)',
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
      if (params.user) queryParams.append('user', params.user)
      if (params.market) queryParams.append('market', params.market)
      // Default limit to 50 to prevent browser crashes from large data sets
      queryParams.append('limit', params.limit || '50')
      if (params.offset) queryParams.append('offset', params.offset)

      const query = queryParams.toString()
      const url = buildDataUrl('/trades')
      return `${url}?${query}`
    },
    method: 'GET',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      handlePolymarketError(data, response.status, 'get_trades')
    }

    // Response is an array of trades
    const trades = Array.isArray(data) ? data : []

    return {
      success: true,
      output: {
        trades,
      },
    }
  },

  outputs: {
    trades: {
      type: 'array',
      description: 'Array of trade objects',
    },
  },
}
