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

export interface SportmonksGetExtendedTeamSquadParams extends SportmonksBaseParams {
  teamId: string
}

export interface SportmonksGetExtendedTeamSquadResponse extends ToolResponse {
  output: {
    squad: SportmonksSquadEntry[]
  }
}

export const sportmonksGetExtendedTeamSquadTool: ToolConfig<
  SportmonksGetExtendedTeamSquadParams,
  SportmonksGetExtendedTeamSquadResponse
> = {
  id: 'sportmonks_football_get_extended_team_squad',
  name: 'Get Extended Team Squad',
  description: 'Retrieve all squad entries for a team (based on current seasons) by team ID',
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
      const url = `${SPORTMONKS_FOOTBALL_BASE_URL}/squads/teams/${encodeURIComponent(params.teamId.trim())}/extended`
      return appendSportmonksQuery(url, params)
    },
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_extended_team_squad')
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
      description: 'Array of extended squad entries for the team',
      items: { type: 'object', properties: SPORTMONKS_SQUAD_PROPERTIES },
    },
  },
}
