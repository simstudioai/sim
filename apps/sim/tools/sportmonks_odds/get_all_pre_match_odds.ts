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
  SPORTMONKS_FOOTBALL_ODDS_BASE_URL,
  SPORTMONKS_ODD_PROPERTIES,
  type SportmonksOdd,
} from '@/tools/sportmonks_odds/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface SportmonksGetAllPreMatchOddsParams
  extends SportmonksBaseParams,
    SportmonksPaginationParams {}

export interface SportmonksGetAllPreMatchOddsResponse extends ToolResponse {
  output: {
    odds: SportmonksOdd[]
    pagination?: SportmonksPagination | null
  }
}

export const sportmonksOddsGetAllPreMatchOddsTool: ToolConfig<
  SportmonksGetAllPreMatchOddsParams,
  SportmonksGetAllPreMatchOddsResponse
> = {
  id: 'sportmonks_odds_get_all_pre_match_odds',
  name: 'Get All Pre-match Odds',
  description: 'Retrieve all available pre-match odds from the Sportmonks Odds API',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Sportmonks API token',
    },
    include: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Semicolon-separated relations to enrich the response (e.g. market;bookmaker)',
    },
    filters: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Filters to apply (e.g. markets:1,12, bookmakers:2,14, winningOdds, IdAfter:oddID)',
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
    url: (params) =>
      appendSportmonksQuery(`${SPORTMONKS_FOOTBALL_ODDS_BASE_URL}/pre-match`, params),
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_all_pre_match_odds')
    }
    return {
      success: true,
      output: {
        odds: Array.isArray(data.data) ? data.data : [],
        pagination: data.pagination ?? null,
      },
    }
  },

  outputs: {
    odds: {
      type: 'array',
      description: 'Array of pre-match odd objects',
      items: { type: 'object', properties: SPORTMONKS_ODD_PROPERTIES },
    },
    pagination: SPORTMONKS_PAGINATION_OUTPUT,
  },
}
