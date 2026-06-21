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

export interface SportmonksGetAllPlayersParams
  extends SportmonksBaseParams,
    SportmonksPaginationParams {}

export interface SportmonksGetAllPlayersResponse extends ToolResponse {
  output: {
    players: SportmonksPlayer[]
    pagination?: SportmonksPagination | null
  }
}

export const sportmonksGetAllPlayersTool: ToolConfig<
  SportmonksGetAllPlayersParams,
  SportmonksGetAllPlayersResponse
> = {
  id: 'sportmonks_football_get_all_players',
  name: 'Get All Players',
  description: 'Retrieve all football players available within your Sportmonks subscription',
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
    url: (params) => appendSportmonksQuery(`${SPORTMONKS_FOOTBALL_BASE_URL}/players`, params),
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_all_players')
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
      description: 'Array of player objects',
      items: { type: 'object', properties: SPORTMONKS_PLAYER_PROPERTIES },
    },
    pagination: SPORTMONKS_PAGINATION_OUTPUT,
  },
}
