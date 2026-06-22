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

export interface SportmonksGetPreMatchOddsParams
  extends SportmonksBaseParams,
    SportmonksPaginationParams {
  fixtureId: string
}

export interface SportmonksGetPreMatchOddsResponse extends ToolResponse {
  output: {
    odds: SportmonksOdd[]
    pagination?: SportmonksPagination | null
  }
}

export const sportmonksOddsGetPreMatchOddsByFixtureTool: ToolConfig<
  SportmonksGetPreMatchOddsParams,
  SportmonksGetPreMatchOddsResponse
> = {
  id: 'sportmonks_odds_get_pre_match_odds_by_fixture',
  name: 'Get Pre-match Odds by Fixture',
  description: 'Retrieve pre-match odds for a fixture by fixture ID from the Sportmonks Odds API',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Sportmonks API token',
    },
    fixtureId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The unique id of the fixture',
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
      description: 'Filters to apply (e.g. markets:1,12 or bookmakers:2,14 or winningOdds)',
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
      const url = `${SPORTMONKS_FOOTBALL_ODDS_BASE_URL}/pre-match/fixtures/${encodeURIComponent(params.fixtureId.trim())}`
      return appendSportmonksQuery(url, params)
    },
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_pre_match_odds_by_fixture')
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
      description: 'Array of pre-match odd objects for the fixture',
      items: { type: 'object', properties: SPORTMONKS_ODD_PROPERTIES },
    },
    pagination: SPORTMONKS_PAGINATION_OUTPUT,
  },
}
