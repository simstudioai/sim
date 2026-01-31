import type { PolymarketOrderBook } from '@/tools/polymarket/types'
import { buildClobUrl, handlePolymarketError } from '@/tools/polymarket/types'
import type { ToolConfig } from '@/tools/types'

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
      description:
        'The CLOB token ID from market clobTokenIds array (e.g., "71321045679252212594626385532706912750332728571942532289631379312455583992563").',
      visibility: 'user-or-llm',
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

    const orderbook: PolymarketOrderBook = {
      market: data.market ?? '',
      asset_id: data.asset_id ?? '',
      hash: data.hash ?? '',
      timestamp: data.timestamp ?? '',
      bids: data.bids ?? [],
      asks: data.asks ?? [],
      min_order_size: data.min_order_size ?? '0',
      tick_size: data.tick_size ?? '0',
      neg_risk: data.neg_risk ?? false,
    }

    return {
      success: true,
      output: {
        orderbook,
      },
    }
  },

  outputs: {
    orderbook: {
      type: 'object',
      description: 'Order book with bids and asks arrays',
      properties: {
        market: { type: 'string', description: 'Market identifier' },
        asset_id: { type: 'string', description: 'Asset token ID' },
        hash: { type: 'string', description: 'Order book hash' },
        timestamp: { type: 'string', description: 'Timestamp' },
        bids: {
          type: 'array',
          description: 'Bid orders',
          items: {
            type: 'object',
            properties: {
              price: { type: 'string', description: 'Bid price' },
              size: { type: 'string', description: 'Bid size' },
            },
          },
        },
        asks: {
          type: 'array',
          description: 'Ask orders',
          items: {
            type: 'object',
            properties: {
              price: { type: 'string', description: 'Ask price' },
              size: { type: 'string', description: 'Ask size' },
            },
          },
        },
        min_order_size: { type: 'string', description: 'Minimum order size' },
        tick_size: { type: 'string', description: 'Tick size' },
        neg_risk: { type: 'boolean', description: 'Whether negative risk' },
      },
    },
  },
}
