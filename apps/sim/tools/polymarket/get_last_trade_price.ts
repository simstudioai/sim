import { buildClobUrl, handlePolymarketError } from '@/tools/polymarket/types'
import type { ToolConfig } from '@/tools/types'

export interface PolymarketGetLastTradePriceParams {
  tokenId: string // The token ID (CLOB token ID from market)
}

export interface PolymarketGetLastTradePriceResponse {
  success: boolean
  output: {
    price: string
    side: string
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
      description:
        'The CLOB token ID from market clobTokenIds array (e.g., "71321045679252212594626385532706912750332728571942532289631379312455583992563").',
      visibility: 'user-or-llm',
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
        price: data.price ?? '',
        side: data.side ?? '',
      },
    }
  },

  outputs: {
    price: {
      type: 'string',
      description: 'Last trade price',
    },
    side: {
      type: 'string',
      description: 'Side of the last trade (BUY or SELL)',
    },
  },
}
