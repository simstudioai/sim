import type { ToolConfig } from '@/tools/types'
import { buildClobUrl, handlePolymarketError } from './types'

export interface PolymarketGetLastTradePriceParams {
  tokenId: string // The token ID (CLOB token ID from market)
}

export interface PolymarketGetLastTradePriceResponse {
  success: boolean
  output: {
    price: string
  }
}

export const polymarketGetLastTradePriceTool: ToolConfig<
  PolymarketGetLastTradePriceParams,
  PolymarketGetLastTradePriceResponse
> = {
  id: 'polymarket_get_last_trade_price',
  name: 'Get Last Trade Price from Polymarket',
  description: 'Retrieve the last trade price for a specific token',
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
      return `${buildClobUrl('/last-trade-price')}?${queryParams.toString()}`
    },
    method: 'GET',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      handlePolymarketError(data, response.status, 'get_last_trade_price')
    }

    return {
      success: true,
      output: {
        price: typeof data === 'string' ? data : data.price || '',
      },
    }
  },

  outputs: {
    price: {
      type: 'string',
      description: 'Last trade price',
    },
  },
}
