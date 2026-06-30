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
  SPORTMONKS_EXPECTED_LINEUP_PROPERTIES,
  SPORTMONKS_FOOTBALL_BASE_URL,
  type SportmonksExpectedLineup,
} from '@/tools/sportmonks_football/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface SportmonksGetExpectedLineupsByTeamParams
  extends SportmonksBaseParams,
    SportmonksPaginationParams {
  teamId: string
}

export interface SportmonksGetExpectedLineupsByTeamResponse extends ToolResponse {
  output: {
    expectedLineups: SportmonksExpectedLineup[]
    pagination?: SportmonksPagination | null
  }
}

export const sportmonksGetExpectedLineupsByTeamTool: ToolConfig<
  SportmonksGetExpectedLineupsByTeamParams,
  SportmonksGetExpectedLineupsByTeamResponse
> = {
  id: 'sportmonks_football_get_expected_lineups_by_team',
  name: 'Get Expected Lineups by Team',
  description: 'Retrieve the premium expected lineups for a team ID from Sportmonks',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Sportmonks API token',
    },
    teamId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The unique id of the team',
    },
    include: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Semicolon-separated relations to enrich the response (e.g. player;fixture)',
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
      const url = `${SPORTMONKS_FOOTBALL_BASE_URL}/expected-lineups/teams/${encodeURIComponent(params.teamId.trim())}`
      return appendSportmonksQuery(url, params)
    },
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_expected_lineups_by_team')
    }
    return {
      success: true,
      output: {
        expectedLineups: Array.isArray(data.data) ? data.data : [],
        pagination: data.pagination ?? null,
      },
    }
  },

  outputs: {
    expectedLineups: {
      type: 'array',
      description: 'Array of expected lineup entries for the team',
      items: { type: 'object', properties: SPORTMONKS_EXPECTED_LINEUP_PROPERTIES },
    },
    pagination: SPORTMONKS_PAGINATION_OUTPUT,
  },
}
