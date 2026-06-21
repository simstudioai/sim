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

export interface SportmonksSearchMarketsParams
  extends SportmonksBaseParams,
    SportmonksPaginationParams {
  query: string
}

export interface SportmonksSearchMarketsResponse extends ToolResponse {
  output: {
    markets: SportmonksMarket[]
    pagination?: SportmonksPagination | null
  }
}

export const sportmonksOddsSearchMarketsTool: ToolConfig<
  SportmonksSearchMarketsParams,
  SportmonksSearchMarketsResponse
> = {
  id: 'sportmonks_odds_search_markets',
  name: 'Search Markets',
  description: 'Search for betting markets by name from the Sportmonks Odds API',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Sportmonks API token',
    },
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The market name to search for (e.g. Over/Under)',
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
    url: (params) => {
      const url = `${SPORTMONKS_ODDS_BASE_URL}/markets/search/${encodeURIComponent(params.query.trim())}`
      return appendSportmonksQuery(url, params)
    },
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'search_markets')
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
      description: 'Array of market objects matching the search query',
      items: { type: 'object', properties: SPORTMONKS_MARKET_PROPERTIES },
    },
    pagination: SPORTMONKS_PAGINATION_OUTPUT,
  },
}
