import type { PolymarketMarket, PolymarketPaginationParams } from '@/tools/polymarket/types'
import { buildGammaUrl, handlePolymarketError } from '@/tools/polymarket/types'
import type { ToolConfig } from '@/tools/types'

export interface PolymarketGetMarketsParams extends PolymarketPaginationParams {
  closed?: string
  order?: string
  ascending?: string
  tagId?: string
}

export interface PolymarketGetMarketsResponse {
  success: boolean
  output: {
    markets: PolymarketMarket[]
  }
}

export const polymarketGetMarketsTool: ToolConfig<
  PolymarketGetMarketsParams,
  PolymarketGetMarketsResponse
> = {
  id: 'polymarket_get_markets',
  name: 'Get Markets from Polymarket',
  description: 'Retrieve a list of prediction markets from Polymarket with optional filtering',
  version: '1.0.0',

  params: {
    closed: {
      type: 'string',
      required: false,
      description: 'Filter by closed status (true/false). Use false for open markets only.',
      visibility: 'user-or-llm',
    },
    order: {
      type: 'string',
      required: false,
      description: 'Sort field (e.g., volumeNum, liquidityNum, startDate, endDate, createdAt)',
      visibility: 'user-or-llm',
    },
    ascending: {
      type: 'string',
      required: false,
      description: 'Sort direction (true for ascending, false for descending)',
      visibility: 'user-or-llm',
    },
    tagId: {
      type: 'string',
      required: false,
      description: 'Filter by tag ID',
      visibility: 'user-or-llm',
    },
    limit: {
      type: 'string',
      required: false,
      description: 'Number of results per page (e.g., "25"). Max: 50.',
      visibility: 'user-or-llm',
    },
    offset: {
      type: 'string',
      required: false,
      description: 'Number of results to skip for pagination (e.g., "50").',
      visibility: 'user-or-llm',
    },
  },

  request: {
    url: (params) => {
      const queryParams = new URLSearchParams()
      if (params.closed) queryParams.append('closed', params.closed)
      if (params.order) queryParams.append('order', params.order)
      if (params.ascending) queryParams.append('ascending', params.ascending)
      if (params.tagId) queryParams.append('tag_id', params.tagId)
      queryParams.append('limit', params.limit || '50')
      if (params.offset) queryParams.append('offset', params.offset)

      const url = buildGammaUrl('/markets')
      return `${url}?${queryParams.toString()}`
    },
    method: 'GET',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      handlePolymarketError(data, response.status, 'get_markets')
    }

    // Response is an array of markets
    const markets = Array.isArray(data) ? data : []

    return {
      success: true,
      output: {
        markets,
      },
    }
  },

  outputs: {
    markets: {
      type: 'array',
      description: 'Array of market objects',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Market ID' },
          question: { type: 'string', description: 'Market question' },
          conditionId: { type: 'string', description: 'Condition ID' },
          slug: { type: 'string', description: 'Market slug' },
          endDate: { type: 'string', description: 'End date' },
          image: { type: 'string', description: 'Market image URL' },
          outcomes: { type: 'string', description: 'Outcomes JSON string' },
          outcomePrices: { type: 'string', description: 'Outcome prices JSON string' },
          volume: { type: 'string', description: 'Total volume' },
          liquidity: { type: 'string', description: 'Total liquidity' },
          active: { type: 'boolean', description: 'Whether market is active' },
          closed: { type: 'boolean', description: 'Whether market is closed' },
          volumeNum: { type: 'number', description: 'Volume as number' },
          liquidityNum: { type: 'number', description: 'Liquidity as number' },
          clobTokenIds: { type: 'array', description: 'CLOB token IDs' },
        },
      },
    },
  },
}
