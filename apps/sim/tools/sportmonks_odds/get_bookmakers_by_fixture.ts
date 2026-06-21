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

export interface SportmonksGetBookmakersByFixtureParams
  extends SportmonksBaseParams,
    SportmonksPaginationParams {
  fixtureId: string
}

export interface SportmonksGetBookmakersByFixtureResponse extends ToolResponse {
  output: {
    bookmakers: SportmonksBookmaker[]
    pagination?: SportmonksPagination | null
  }
}

export const sportmonksOddsGetBookmakersByFixtureTool: ToolConfig<
  SportmonksGetBookmakersByFixtureParams,
  SportmonksGetBookmakersByFixtureResponse
> = {
  id: 'sportmonks_odds_get_bookmakers_by_fixture',
  name: 'Get Bookmakers by Fixture',
  description: 'Retrieve all bookmakers available for a fixture from the Sportmonks Odds API',
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
      const url = `${SPORTMONKS_ODDS_BASE_URL}/bookmakers/fixtures/${encodeURIComponent(params.fixtureId.trim())}`
      return appendSportmonksQuery(url, params)
    },
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_bookmakers_by_fixture')
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
      description: 'Array of bookmaker objects available for the fixture',
      items: { type: 'object', properties: SPORTMONKS_BOOKMAKER_PROPERTIES },
    },
    pagination: SPORTMONKS_PAGINATION_OUTPUT,
  },
}
