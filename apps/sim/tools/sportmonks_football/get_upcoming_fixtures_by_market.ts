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
  SPORTMONKS_FIXTURE_PROPERTIES,
  SPORTMONKS_FOOTBALL_BASE_URL,
  type SportmonksFixture,
} from '@/tools/sportmonks_football/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface SportmonksGetUpcomingFixturesByMarketParams
  extends SportmonksBaseParams,
    SportmonksPaginationParams {
  marketId: string
}

export interface SportmonksGetUpcomingFixturesByMarketResponse extends ToolResponse {
  output: {
    fixtures: SportmonksFixture[]
    pagination?: SportmonksPagination | null
  }
}

export const sportmonksGetUpcomingFixturesByMarketTool: ToolConfig<
  SportmonksGetUpcomingFixturesByMarketParams,
  SportmonksGetUpcomingFixturesByMarketResponse
> = {
  id: 'sportmonks_football_get_upcoming_fixtures_by_market',
  name: 'Get Upcoming Fixtures by Market',
  description: 'Retrieve all upcoming fixtures for a market ID from Sportmonks',
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
    include: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Semicolon-separated relations to enrich the response (e.g. participants;odds)',
    },
    filters: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filters to apply (e.g. fixtureLeagues:501)',
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
      const url = `${SPORTMONKS_FOOTBALL_BASE_URL}/fixtures/upcoming/markets/${encodeURIComponent(params.marketId.trim())}`
      return appendSportmonksQuery(url, params)
    },
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_upcoming_fixtures_by_market')
    }
    return {
      success: true,
      output: {
        fixtures: Array.isArray(data.data) ? data.data : [],
        pagination: data.pagination ?? null,
      },
    }
  },

  outputs: {
    fixtures: {
      type: 'array',
      description: 'Array of upcoming fixture objects for the market',
      items: { type: 'object', properties: SPORTMONKS_FIXTURE_PROPERTIES },
    },
    pagination: SPORTMONKS_PAGINATION_OUTPUT,
  },
}
