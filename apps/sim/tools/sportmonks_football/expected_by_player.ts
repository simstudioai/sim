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
  SPORTMONKS_EXPECTED_PLAYER_PROPERTIES,
  SPORTMONKS_FOOTBALL_BASE_URL,
  type SportmonksExpectedPlayer,
} from '@/tools/sportmonks_football/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface SportmonksExpectedByPlayerParams
  extends SportmonksBaseParams,
    SportmonksPaginationParams {}

export interface SportmonksExpectedByPlayerResponse extends ToolResponse {
  output: {
    expected: SportmonksExpectedPlayer[]
    pagination?: SportmonksPagination | null
  }
}

export const sportmonksExpectedByPlayerTool: ToolConfig<
  SportmonksExpectedByPlayerParams,
  SportmonksExpectedByPlayerResponse
> = {
  id: 'sportmonks_football_expected_by_player',
  name: 'Get Expected xG by Player',
  description: 'Retrieve lineup-level expected goals (xG) values per player from Sportmonks',
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
        'Semicolon-separated relations to enrich the response (e.g. fixture;player;team;type)',
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
    url: (params) =>
      appendSportmonksQuery(`${SPORTMONKS_FOOTBALL_BASE_URL}/expected/lineups`, params),
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'expected_by_player')
    }
    return {
      success: true,
      output: {
        expected: Array.isArray(data.data) ? data.data : [],
        pagination: data.pagination ?? null,
      },
    }
  },

  outputs: {
    expected: {
      type: 'array',
      description: 'Array of player-level expected goals (xG) entries',
      items: { type: 'object', properties: SPORTMONKS_EXPECTED_PLAYER_PROPERTIES },
    },
    pagination: SPORTMONKS_PAGINATION_OUTPUT,
  },
}
