import type { ToolConfig } from '@/tools/types'
import type { PolymarketOrderBook } from './types'
import { buildClobUrl, handlePolymarketError } from './types'

export interface PolymarketGetOrderbookParams {
  tokenId: string // The token ID (CLOB token ID from market)
}

export interface PolymarketGetOrderbookResponse {
  success: boolean
  output: {
    orderbook: PolymarketOrderBook
  }
}

export const polymarketGetOrderbookTool: ToolConfig<
  PolymarketGetOrderbookParams,
  PolymarketGetOrderbookResponse
> = {
  id: 'polymarket_get_orderbook',
  name: 'Get Orderbook from Polymarket',
  description: 'Retrieve the order book summary for a specific token',
  version: '1.0.0',

  params: {
    tokenId: {
      type: 'string',
      required: true,
      description: 'The CLOB token ID (from market clobTokenIds)',
    },
  },

  request: {
    url: (params) => {
      const queryParams = new URLSearchParams()
      queryParams.append('token_id', params.tokenId)
      return `${buildClobUrl('/book')}?${queryParams.toString()}`
    },
    method: 'GET',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      handlePolymarketError(data, response.status, 'get_orderbook')
    }

    return {
      success: true,
      output: {
        orderbook: data,
      },
    }
  },

  outputs: {
    orderbook: {
      type: 'object',
      description: 'Order book with bids and asks arrays',
    },
  },
}
