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
  SPORTMONKS_PLAYER_PROPERTIES,
  type SportmonksPlayer,
} from '@/tools/sportmonks_football/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface SportmonksGetPlayersByCountryParams
  extends SportmonksBaseParams,
    SportmonksPaginationParams {
  countryId: string
}

export interface SportmonksGetPlayersByCountryResponse extends ToolResponse {
  output: {
    players: SportmonksPlayer[]
    pagination?: SportmonksPagination | null
  }
}

export const sportmonksGetPlayersByCountryTool: ToolConfig<
  SportmonksGetPlayersByCountryParams,
  SportmonksGetPlayersByCountryResponse
> = {
  id: 'sportmonks_football_get_players_by_country',
  name: 'Get Players by Country',
  description: 'Retrieve all players for a country ID from Sportmonks',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Sportmonks API token',
    },
    countryId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The unique id of the country',
    },
    include: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Semicolon-separated relations to enrich the response (e.g. nationality;position)',
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
      description: 'Order players by id (asc or desc)',
    },
  },

  request: {
    url: (params) => {
      const url = `${SPORTMONKS_FOOTBALL_BASE_URL}/players/countries/${encodeURIComponent(params.countryId.trim())}`
      return appendSportmonksQuery(url, params)
    },
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_players_by_country')
    }
    return {
      success: true,
      output: {
        players: Array.isArray(data.data) ? data.data : [],
        pagination: data.pagination ?? null,
      },
    }
  },

  outputs: {
    players: {
      type: 'array',
      description: 'Array of player objects for the country',
      items: { type: 'object', properties: SPORTMONKS_PLAYER_PROPERTIES },
    },
    pagination: SPORTMONKS_PAGINATION_OUTPUT,
  },
}
