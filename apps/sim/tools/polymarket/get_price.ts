import type { ToolConfig } from '@/tools/types'
import { buildClobUrl, handlePolymarketError } from './types'

export interface PolymarketGetPriceParams {
  tokenId: string // The token ID (CLOB token ID from market)
  side: string // 'buy' or 'sell'
}

export interface PolymarketGetPriceResponse {
  success: boolean
  output: {
    price: string
    side: string
    metadata: {
      operation: 'get_price'
    }
    success: boolean
  }
}

export const polymarketGetPriceTool: ToolConfig<
  PolymarketGetPriceParams,
  PolymarketGetPriceResponse
> = {
  id: 'polymarket_get_price',
  name: 'Get Price from Polymarket',
  description: 'Retrieve the market price for a specific token and side',
  version: '1.0.0',

  params: {
    tokenId: {
      type: 'string',
      required: true,
      description: 'The CLOB token ID (from market clobTokenIds)',
    },
    side: {
      type: 'string',
      required: true,
      description: 'Order side: buy or sell',
    },
  },

  request: {
    url: (params) => {
      const queryParams = new URLSearchParams()
      queryParams.append('token_id', params.tokenId)
      queryParams.append('side', params.side.toUpperCase())
      return `${buildClobUrl('/price')}?${queryParams.toString()}`
    },
    method: 'GET',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      handlePolymarketError(data, response.status, 'get_price')
    }

    return {
      success: true,
      output: {
        price: data.price || data,
        side: data.side || '',
        metadata: {
          operation: 'get_price' as const,
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Price data and metadata',
      properties: {
        price: { type: 'string', description: 'Market price' },
        side: { type: 'string', description: 'Order side' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
