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
    metadata: {
      operation: 'get_market'
    }
    success: boolean
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
        metadata: {
          operation: 'get_market' as const,
        },
        success: true,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Operation success status' },
    output: {
      type: 'object',
      description: 'Market data and metadata',
      properties: {
        market: { type: 'object', description: 'Market object' },
        metadata: { type: 'object', description: 'Operation metadata' },
        success: { type: 'boolean', description: 'Operation success' },
      },
    },
  },
}
