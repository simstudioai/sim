import {
  buildSportmonksHeaders,
  handleSportmonksError,
  type SportmonksBaseParams,
} from '@/tools/sportmonks/types'
import {
  SPORTMONKS_MARKET_PROPERTIES,
  SPORTMONKS_ODDS_BASE_URL,
  type SportmonksMarket,
} from '@/tools/sportmonks_odds/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface SportmonksGetMarketParams extends SportmonksBaseParams {
  marketId: string
}

export interface SportmonksGetMarketResponse extends ToolResponse {
  output: {
    market: SportmonksMarket | null
  }
}

export const sportmonksOddsGetMarketTool: ToolConfig<
  SportmonksGetMarketParams,
  SportmonksGetMarketResponse
> = {
  id: 'sportmonks_odds_get_market',
  name: 'Get Market by ID',
  description: 'Retrieve a single betting market by its ID from the Sportmonks Odds API',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Sportmonks API token',
    },
    marketId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The unique id of the market',
    },
  },

  request: {
    url: (params) =>
      `${SPORTMONKS_ODDS_BASE_URL}/markets/${encodeURIComponent(params.marketId.trim())}`,
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_market')
    }
    return {
      success: true,
      output: {
        market: data.data ?? null,
      },
    }
  },

  outputs: {
    market: {
      type: 'object',
      description: 'The requested market object',
      properties: SPORTMONKS_MARKET_PROPERTIES,
    },
  },
}
