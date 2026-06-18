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
  SPORTMONKS_FOOTBALL_BASE_URL,
  SPORTMONKS_TVSTATION_PROPERTIES,
  type SportmonksTVStation,
} from '@/tools/sportmonks_football/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface SportmonksGetTvStationsByFixtureParams
  extends SportmonksBaseParams,
    SportmonksPaginationParams {
  fixtureId: string
}

export interface SportmonksGetTvStationsByFixtureResponse extends ToolResponse {
  output: {
    tvStations: SportmonksTVStation[]
    pagination?: SportmonksPagination | null
  }
}

export const sportmonksGetTvStationsByFixtureTool: ToolConfig<
  SportmonksGetTvStationsByFixtureParams,
  SportmonksGetTvStationsByFixtureResponse
> = {
  id: 'sportmonks_football_get_tv_stations_by_fixture',
  name: 'Get TV Stations by Fixture',
  description: 'Retrieve broadcasting TV stations for a fixture by fixture ID from Sportmonks',
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
      description: 'Semicolon-separated relations to enrich the response (e.g. fixtures;countries)',
    },
    filters: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filters to apply',
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
      const url = `${SPORTMONKS_FOOTBALL_BASE_URL}/tv-stations/fixtures/${encodeURIComponent(params.fixtureId.trim())}`
      return appendSportmonksQuery(url, params)
    },
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_tv_stations_by_fixture')
    }
    return {
      success: true,
      output: {
        tvStations: Array.isArray(data.data) ? data.data : [],
        pagination: data.pagination ?? null,
      },
    }
  },

  outputs: {
    tvStations: {
      type: 'array',
      description: 'Array of TV station objects broadcasting the fixture',
      items: { type: 'object', properties: SPORTMONKS_TVSTATION_PROPERTIES },
    },
    pagination: SPORTMONKS_PAGINATION_OUTPUT,
  },
}
