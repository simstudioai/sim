import {
  appendSportmonksQuery,
  buildSportmonksHeaders,
  handleSportmonksError,
  SPORTMONKS_PAGINATION_OUTPUT,
  type SportmonksBaseParams,
  type SportmonksPagination,
  type SportmonksPaginationParams,
} from '@/tools/sportmonks/types'
import {
  SPORTMONKS_MARKET_PROPERTIES,
  SPORTMONKS_ODDS_BASE_URL,
  type SportmonksMarket,
} from '@/tools/sportmonks_odds/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface SportmonksGetMarketsParams
  extends SportmonksBaseParams,
    SportmonksPaginationParams {}

export interface SportmonksGetMarketsResponse extends ToolResponse {
  output: {
    markets: SportmonksMarket[]
    pagination?: SportmonksPagination | null
  }
}

export const sportmonksOddsGetMarketsTool: ToolConfig<
  SportmonksGetMarketsParams,
  SportmonksGetMarketsResponse
> = {
  id: 'sportmonks_odds_get_markets',
  name: 'Get Markets',
  description: 'Retrieve all betting markets from the Sportmonks Odds API',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Sportmonks API token',
    },
    filters: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filters to apply (e.g. IdAfter:marketID)',
    },
    per_page: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results per page (max 50, default 25)',
    },
    page: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page number to retrieve',
    },
    order: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Order direction (asc or desc)',
    },
  },

  request: {
    url: (params) => appendSportmonksQuery(`${SPORTMONKS_ODDS_BASE_URL}/markets`, params),
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_markets')
    }
    return {
      success: true,
      output: {
        markets: Array.isArray(data.data) ? data.data : [],
        pagination: data.pagination ?? null,
      },
    }
  },

  outputs: {
    markets: {
      type: 'array',
      description: 'Array of market objects',
      items: { type: 'object', properties: SPORTMONKS_MARKET_PROPERTIES },
    },
    pagination: SPORTMONKS_PAGINATION_OUTPUT,
  },
}
