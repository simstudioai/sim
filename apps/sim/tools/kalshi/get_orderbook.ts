import type { ToolConfig } from '@/tools/types'
import type { KalshiOrderbook } from './types'
import { buildKalshiUrl, handleKalshiError } from './types'

export interface KalshiGetOrderbookParams {
  ticker: string
}

export interface KalshiGetOrderbookResponse {
  success: boolean
  output: {
    orderbook: KalshiOrderbook
    metadata: {
      operation: 'get_orderbook'
      ticker: string
    }
    success: boolean
  }
}

export const kalshiGetOrderbookTool: ToolConfig<
  KalshiGetOrderbookParams,
  KalshiGetOrderbookResponse
> = {
  id: 'kalshi_get_orderbook',
  name: 'Get Market Orderbook from Kalshi',
  description: 'Retrieve the orderbook (yes and no bids) for a specific market',
  version: '1.0.0',

  params: {
    ticker: {
      type: 'string',
      required: true,
      description: 'Market ticker (e.g., KXBTC-24DEC31)',
    },
  },

  request: {
    url: (params) => buildKalshiUrl(`/markets/${params.ticker}/orderbook`),
    method: 'GET',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      handleKalshiError(data, response.status, 'get_orderbook')
    }

    const orderbook = data.orderbook || { yes: [], no: [] }

    return {
      success: true,
      output: {
        orderbook,
        metadata: {
          operation: 'get_orderbook' as const,
          ticker: data.ticker || '',
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Orderbook data and metadata',
      properties: {
        orderbook: { type: 'object', description: 'Orderbook with yes/no bids and asks' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
