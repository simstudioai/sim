import type { PolymarketMarket } from '@/tools/polymarket/types'
import { buildGammaUrl, handlePolymarketError } from '@/tools/polymarket/types'
import type { ToolConfig } from '@/tools/types'

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
      description:
        'The market ID (e.g., "0x1234...abcd" condition ID format). Required if slug is not provided.',
      visibility: 'user-or-llm',
    },
    slug: {
      type: 'string',
      required: false,
      description:
        'The market slug (e.g., "will-trump-win"). URL-friendly identifier. Required if marketId is not provided.',
      visibility: 'user-or-llm',
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
      properties: {
        id: { type: 'string', description: 'Market ID' },
        question: { type: 'string', description: 'Market question' },
        conditionId: { type: 'string', description: 'Condition ID' },
        slug: { type: 'string', description: 'Market slug' },
        resolutionSource: { type: 'string', description: 'Resolution source' },
        endDate: { type: 'string', description: 'End date' },
        startDate: { type: 'string', description: 'Start date' },
        image: { type: 'string', description: 'Market image URL' },
        icon: { type: 'string', description: 'Market icon URL' },
        description: { type: 'string', description: 'Market description' },
        outcomes: { type: 'string', description: 'Outcomes JSON string' },
        outcomePrices: { type: 'string', description: 'Outcome prices JSON string' },
        volume: { type: 'string', description: 'Total volume' },
        liquidity: { type: 'string', description: 'Total liquidity' },
        active: { type: 'boolean', description: 'Whether market is active' },
        closed: { type: 'boolean', description: 'Whether market is closed' },
        archived: { type: 'boolean', description: 'Whether market is archived' },
        volumeNum: { type: 'number', description: 'Volume as number' },
        liquidityNum: { type: 'number', description: 'Liquidity as number' },
        clobTokenIds: { type: 'array', description: 'CLOB token IDs' },
        acceptingOrders: { type: 'boolean', description: 'Whether accepting orders' },
        negRisk: { type: 'boolean', description: 'Whether negative risk' },
      },
    },
  },
}
