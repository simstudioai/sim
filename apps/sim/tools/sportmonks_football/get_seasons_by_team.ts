import {
  appendSportmonksQuery,
  buildSportmonksHeaders,
  handleSportmonksError,
  type SportmonksBaseParams,
} from '@/tools/sportmonks/types'
import {
  SPORTMONKS_FOOTBALL_BASE_URL,
  SPORTMONKS_SEASON_PROPERTIES,
  type SportmonksSeason,
} from '@/tools/sportmonks_football/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface SportmonksGetSeasonsByTeamParams extends SportmonksBaseParams {
  teamId: string
}

export interface SportmonksGetSeasonsByTeamResponse extends ToolResponse {
  output: {
    seasons: SportmonksSeason[]
  }
}

export const sportmonksGetSeasonsByTeamTool: ToolConfig<
  SportmonksGetSeasonsByTeamParams,
  SportmonksGetSeasonsByTeamResponse
> = {
  id: 'sportmonks_football_get_seasons_by_team',
  name: 'Get Seasons by Team',
  description: 'Retrieve all seasons for a team ID from Sportmonks',
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
      description: 'Semicolon-separated relations to enrich the response (e.g. league;stages)',
    },
    filters: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filters to apply',
    },
  },

  request: {
    url: (params) => {
      const url = `${SPORTMONKS_FOOTBALL_BASE_URL}/seasons/teams/${encodeURIComponent(params.teamId.trim())}`
      return appendSportmonksQuery(url, params)
    },
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_seasons_by_team')
    }
    return {
      success: true,
      output: {
        seasons: Array.isArray(data.data) ? data.data : [],
      },
    }
  },

  outputs: {
    seasons: {
      type: 'array',
      description: 'Array of season objects for the team',
      items: { type: 'object', properties: SPORTMONKS_SEASON_PROPERTIES },
    },
  },
}
