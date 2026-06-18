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

export interface SportmonksGetTeamRankingsByDateParams
  extends SportmonksBaseParams,
    SportmonksPaginationParams {
  date: string
}

export interface SportmonksGetTeamRankingsByDateResponse extends ToolResponse {
  output: {
    teamRankings: SportmonksTeamRanking[]
    pagination?: SportmonksPagination | null
  }
}

export const sportmonksGetTeamRankingsByDateTool: ToolConfig<
  SportmonksGetTeamRankingsByDateParams,
  SportmonksGetTeamRankingsByDateResponse
> = {
  id: 'sportmonks_football_get_team_rankings_by_date',
  name: 'Get Team Rankings by Date',
  description: 'Retrieve team rankings for a given date (YYYY-MM-DD) from Sportmonks (beta)',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Sportmonks API token',
    },
    date: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ranking date in YYYY-MM-DD format',
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
      const url = `${SPORTMONKS_FOOTBALL_BASE_URL}/team-rankings/date/${encodeURIComponent(params.date.trim())}`
      return appendSportmonksQuery(url, params)
    },
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_team_rankings_by_date')
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
      description: 'Array of team ranking objects for the date',
      items: { type: 'object', properties: SPORTMONKS_TEAM_RANKING_PROPERTIES },
    },
    pagination: SPORTMONKS_PAGINATION_OUTPUT,
  },
}
