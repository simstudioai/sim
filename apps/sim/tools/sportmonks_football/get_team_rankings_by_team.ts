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
  SPORTMONKS_TEAM_RANKING_PROPERTIES,
  type SportmonksTeamRanking,
} from '@/tools/sportmonks_football/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface SportmonksGetTeamRankingsByTeamParams
  extends SportmonksBaseParams,
    SportmonksPaginationParams {
  teamId: string
}

export interface SportmonksGetTeamRankingsByTeamResponse extends ToolResponse {
  output: {
    teamRankings: SportmonksTeamRanking[]
    pagination?: SportmonksPagination | null
  }
}

export const sportmonksGetTeamRankingsByTeamTool: ToolConfig<
  SportmonksGetTeamRankingsByTeamParams,
  SportmonksGetTeamRankingsByTeamResponse
> = {
  id: 'sportmonks_football_get_team_rankings_by_team',
  name: 'Get Team Rankings by Team',
  description: 'Retrieve team rankings for a team ID from Sportmonks (beta)',
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
      description: 'Semicolon-separated relations to enrich the response (e.g. team)',
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
      const url = `${SPORTMONKS_FOOTBALL_BASE_URL}/team-rankings/teams/${encodeURIComponent(params.teamId.trim())}`
      return appendSportmonksQuery(url, params)
    },
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_team_rankings_by_team')
    }
    return {
      success: true,
      output: {
        teamRankings: Array.isArray(data.data) ? data.data : [],
        pagination: data.pagination ?? null,
      },
    }
  },

  outputs: {
    teamRankings: {
      type: 'array',
      description: 'Array of team ranking objects for the team',
      items: { type: 'object', properties: SPORTMONKS_TEAM_RANKING_PROPERTIES },
    },
    pagination: SPORTMONKS_PAGINATION_OUTPUT,
  },
}
