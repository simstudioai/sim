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
  SPORTMONKS_LEAGUE_PROPERTIES,
  type SportmonksLeague,
} from '@/tools/sportmonks_football/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface SportmonksGetLeaguesByTeamParams
  extends SportmonksBaseParams,
    SportmonksPaginationParams {
  teamId: string
}

export interface SportmonksGetLeaguesByTeamResponse extends ToolResponse {
  output: {
    leagues: SportmonksLeague[]
    pagination?: SportmonksPagination | null
  }
}

export const sportmonksGetLeaguesByTeamTool: ToolConfig<
  SportmonksGetLeaguesByTeamParams,
  SportmonksGetLeaguesByTeamResponse
> = {
  id: 'sportmonks_football_get_leagues_by_team',
  name: 'Get Leagues by Team',
  description: 'Retrieve all current and historical leagues for a team ID from Sportmonks',
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
      description:
        'Semicolon-separated relations to enrich the response (e.g. country;currentSeason)',
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
      description: 'Order leagues (asc or desc)',
    },
  },

  request: {
    url: (params) => {
      const url = `${SPORTMONKS_FOOTBALL_BASE_URL}/leagues/teams/${encodeURIComponent(params.teamId.trim())}`
      return appendSportmonksQuery(url, params)
    },
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_leagues_by_team')
    }
    return {
      success: true,
      output: {
        leagues: Array.isArray(data.data) ? data.data : [],
        pagination: data.pagination ?? null,
      },
    }
  },

  outputs: {
    leagues: {
      type: 'array',
      description: 'Array of current and historical league objects for the team',
      items: { type: 'object', properties: SPORTMONKS_LEAGUE_PROPERTIES },
    },
    pagination: SPORTMONKS_PAGINATION_OUTPUT,
  },
}
