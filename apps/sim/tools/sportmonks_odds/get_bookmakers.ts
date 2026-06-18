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

export interface SportmonksGetBookmakersParams
  extends SportmonksBaseParams,
    SportmonksPaginationParams {}

export interface SportmonksGetBookmakersResponse extends ToolResponse {
  output: {
    bookmakers: SportmonksBookmaker[]
    pagination?: SportmonksPagination | null
  }
}

export const sportmonksOddsGetBookmakersTool: ToolConfig<
  SportmonksGetBookmakersParams,
  SportmonksGetBookmakersResponse
> = {
  id: 'sportmonks_odds_get_bookmakers',
  name: 'Get Bookmakers',
  description: 'Retrieve all bookmakers from the Sportmonks Odds API',
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
      description: 'Filters to apply (e.g. IdAfter:bookmakerID)',
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
    url: (params) => appendSportmonksQuery(`${SPORTMONKS_ODDS_BASE_URL}/bookmakers`, params),
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_bookmakers')
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
      description: 'Array of bookmaker objects',
      items: { type: 'object', properties: SPORTMONKS_BOOKMAKER_PROPERTIES },
    },
    pagination: SPORTMONKS_PAGINATION_OUTPUT,
  },
}
