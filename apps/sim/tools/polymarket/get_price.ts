import { buildClobUrl, handlePolymarketError } from '@/tools/polymarket/types'
import type { ToolConfig } from '@/tools/types'

export interface PolymarketGetPriceParams {
  tokenId: string // The token ID (CLOB token ID from market)
  side: string // 'buy' or 'sell'
}

export interface PolymarketGetPriceResponse {
  success: boolean
  output: {
    price: string
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
      description:
        'The CLOB token ID from market clobTokenIds array (e.g., "71321045679252212594626385532706912750332728571942532289631379312455583992563").',
      visibility: 'user-or-llm',
    },
    side: {
      type: 'string',
      required: true,
      description: 'Order side: "buy" or "sell".',
      visibility: 'user-or-llm',
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
      },
    }
  },

  outputs: {
    price: {
      type: 'string',
      description: 'Market price',
    },
  },
}
