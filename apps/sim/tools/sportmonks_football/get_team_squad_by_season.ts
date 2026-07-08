import {
  appendSportmonksQuery,
  buildSportmonksHeaders,
  handleSportmonksError,
  type SportmonksBaseParams,
} from '@/tools/sportmonks/types'
import {
  SPORTMONKS_FOOTBALL_BASE_URL,
  SPORTMONKS_SQUAD_PROPERTIES,
  type SportmonksSquadEntry,
} from '@/tools/sportmonks_football/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface SportmonksGetTeamSquadBySeasonParams extends SportmonksBaseParams {
  seasonId: string
  teamId: string
}

export interface SportmonksGetTeamSquadBySeasonResponse extends ToolResponse {
  output: {
    squad: SportmonksSquadEntry[]
  }
}

export const sportmonksGetTeamSquadBySeasonTool: ToolConfig<
  SportmonksGetTeamSquadBySeasonParams,
  SportmonksGetTeamSquadBySeasonResponse
> = {
  id: 'sportmonks_football_get_team_squad_by_season',
  name: 'Get Team Squad by Season',
  description: 'Retrieve the (historical) squad for a team in a specific season from Sportmonks',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Sportmonks API token',
    },
    seasonId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The unique id of the season',
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
      description: 'Semicolon-separated relations to enrich the response (e.g. player;position)',
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
      const url = `${SPORTMONKS_FOOTBALL_BASE_URL}/squads/seasons/${encodeURIComponent(
        params.seasonId.trim()
      )}/teams/${encodeURIComponent(params.teamId.trim())}`
      return appendSportmonksQuery(url, params)
    },
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_team_squad_by_season')
    }
    return {
      success: true,
      output: {
        squad: Array.isArray(data.data) ? data.data : [],
      },
    }
  },

  outputs: {
    squad: {
      type: 'array',
      description: 'Array of squad entries for the team in the season',
      items: { type: 'object', properties: SPORTMONKS_SQUAD_PROPERTIES },
    },
  },
}
