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

export interface SportmonksGetUpcomingFixturesByTvStationParams
  extends SportmonksBaseParams,
    SportmonksPaginationParams {
  tvStationId: string
}

export interface SportmonksGetUpcomingFixturesByTvStationResponse extends ToolResponse {
  output: {
    fixtures: SportmonksFixture[]
    pagination?: SportmonksPagination | null
  }
}

export const sportmonksGetUpcomingFixturesByTvStationTool: ToolConfig<
  SportmonksGetUpcomingFixturesByTvStationParams,
  SportmonksGetUpcomingFixturesByTvStationResponse
> = {
  id: 'sportmonks_football_get_upcoming_fixtures_by_tv_station',
  name: 'Get Upcoming Fixtures by TV Station',
  description: 'Retrieve all upcoming fixtures available for a TV station ID from Sportmonks',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Sportmonks API token',
    },
    tvStationId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The unique id of the TV station',
    },
    include: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Semicolon-separated relations to enrich the response (e.g. participants)',
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
      const url = `${SPORTMONKS_FOOTBALL_BASE_URL}/fixtures/upcoming/tv-stations/${encodeURIComponent(params.tvStationId.trim())}`
      return appendSportmonksQuery(url, params)
    },
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_upcoming_fixtures_by_tv_station')
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
      description: 'Array of upcoming fixture objects for the TV station',
      items: { type: 'object', properties: SPORTMONKS_FIXTURE_PROPERTIES },
    },
    pagination: SPORTMONKS_PAGINATION_OUTPUT,
  },
}
