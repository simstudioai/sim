import type { ToolConfig } from '@/tools/types'
import type { KalshiPaginationParams, KalshiPagingInfo, KalshiTrade } from './types'
import { buildKalshiUrl, handleKalshiError } from './types'

export interface KalshiGetTradesParams extends KalshiPaginationParams {}

export interface KalshiGetTradesResponse {
  success: boolean
  output: {
    trades: KalshiTrade[]
    paging?: KalshiPagingInfo
    metadata: {
      operation: 'get_trades'
      totalReturned: number
    }
    success: boolean
  }
}

export const kalshiGetTradesTool: ToolConfig<KalshiGetTradesParams, KalshiGetTradesResponse> = {
  id: 'kalshi_get_trades',
  name: 'Get Trades from Kalshi',
  description: 'Retrieve recent trades across all markets',
  version: '1.0.0',

  params: {
    limit: {
      type: 'string',
      required: false,
      description: 'Number of results (1-1000, default: 100)',
    },
    cursor: {
      type: 'string',
      required: false,
      description: 'Pagination cursor for next page',
    },
  },

  request: {
    url: (params) => {
      const queryParams = new URLSearchParams()
      if (params.limit) queryParams.append('limit', params.limit)
      if (params.cursor) queryParams.append('cursor', params.cursor)

      const query = queryParams.toString()
      const url = buildKalshiUrl('/markets/trades')
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
      handleKalshiError(data, response.status, 'get_trades')
    }

    const trades = data.trades || []

    return {
      success: true,
      output: {
        trades,
        paging: {
          cursor: data.cursor || null,
        },
        metadata: {
          operation: 'get_trades' as const,
          totalReturned: trades.length,
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Trades data and metadata',
      properties: {
        trades: { type: 'array', description: 'Array of trade objects' },
        paging: { type: 'object', description: 'Pagination information' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
