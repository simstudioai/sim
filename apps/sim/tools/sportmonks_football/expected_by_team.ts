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
  SPORTMONKS_EXPECTED_TEAM_PROPERTIES,
  SPORTMONKS_FOOTBALL_BASE_URL,
  type SportmonksExpectedTeam,
} from '@/tools/sportmonks_football/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface SportmonksExpectedByTeamParams
  extends SportmonksBaseParams,
    SportmonksPaginationParams {}

export interface SportmonksExpectedByTeamResponse extends ToolResponse {
  output: {
    expected: SportmonksExpectedTeam[]
    pagination?: SportmonksPagination | null
  }
}

export const sportmonksExpectedByTeamTool: ToolConfig<
  SportmonksExpectedByTeamParams,
  SportmonksExpectedByTeamResponse
> = {
  id: 'sportmonks_football_expected_by_team',
  name: 'Get Expected xG by Team',
  description: 'Retrieve fixture-level expected goals (xG) values per team from Sportmonks',
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
        'Semicolon-separated relations to enrich the response (e.g. fixture;participant;type)',
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
      appendSportmonksQuery(`${SPORTMONKS_FOOTBALL_BASE_URL}/expected/fixtures`, params),
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'expected_by_team')
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
      description: 'Array of team-level expected goals (xG) entries',
      items: { type: 'object', properties: SPORTMONKS_EXPECTED_TEAM_PROPERTIES },
    },
    pagination: SPORTMONKS_PAGINATION_OUTPUT,
  },
}
