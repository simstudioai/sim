import type { ToolConfig } from '@/tools/types'
import type { PolymarketMarket } from './types'
import { buildGammaUrl, handlePolymarketError } from './types'

export interface PolymarketGetMarketParams {
  marketId?: string // Market ID
  slug?: string // Market slug (alternative to ID)
}

export interface PolymarketGetMarketResponse {
  success: boolean
  output: {
    market: PolymarketMarket
  }
}

export const polymarketGetMarketTool: ToolConfig<
  PolymarketGetMarketParams,
  PolymarketGetMarketResponse
> = {
  id: 'polymarket_get_market',
  name: 'Get Market from Polymarket',
  description: 'Retrieve details of a specific prediction market by ID or slug',
  version: '1.0.0',

  params: {
    marketId: {
      type: 'string',
      required: false,
      description: 'The market ID. Required if slug is not provided.',
    },
    slug: {
      type: 'string',
      required: false,
      description:
        'The market slug (e.g., "will-trump-win"). Required if marketId is not provided.',
    },
  },

  request: {
    url: (params) => {
      if (params.slug) {
        return buildGammaUrl(`/markets/slug/${params.slug}`)
      }
      return buildGammaUrl(`/markets/${params.marketId}`)
    },
    method: 'GET',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      handlePolymarketError(data, response.status, 'get_market')
    }

    return {
      success: true,
      output: {
        market: data,
      },
    }
  },

  outputs: {
    market: {
      type: 'object',
      description: 'Market object with details',
    },
  },
}
