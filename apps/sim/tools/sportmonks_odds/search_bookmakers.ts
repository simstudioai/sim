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
  SPORTMONKS_BOOKMAKER_PROPERTIES,
  SPORTMONKS_ODDS_BASE_URL,
  type SportmonksBookmaker,
} from '@/tools/sportmonks_odds/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface SportmonksSearchBookmakersParams
  extends SportmonksBaseParams,
    SportmonksPaginationParams {
  query: string
}

export interface SportmonksSearchBookmakersResponse extends ToolResponse {
  output: {
    bookmakers: SportmonksBookmaker[]
    pagination?: SportmonksPagination | null
  }
}

export const sportmonksOddsSearchBookmakersTool: ToolConfig<
  SportmonksSearchBookmakersParams,
  SportmonksSearchBookmakersResponse
> = {
  id: 'sportmonks_odds_search_bookmakers',
  name: 'Search Bookmakers',
  description: 'Search for bookmakers by name from the Sportmonks Odds API',
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
      description: 'The bookmaker name to search for (e.g. bet365)',
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
      const url = `${SPORTMONKS_ODDS_BASE_URL}/bookmakers/search/${encodeURIComponent(params.query.trim())}`
      return appendSportmonksQuery(url, params)
    },
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'search_bookmakers')
    }
    return {
      success: true,
      output: {
        bookmakers: Array.isArray(data.data) ? data.data : [],
        pagination: data.pagination ?? null,
      },
    }
  },

  outputs: {
    bookmakers: {
      type: 'array',
      description: 'Array of bookmaker objects matching the search query',
      items: { type: 'object', properties: SPORTMONKS_BOOKMAKER_PROPERTIES },
    },
    pagination: SPORTMONKS_PAGINATION_OUTPUT,
  },
}
