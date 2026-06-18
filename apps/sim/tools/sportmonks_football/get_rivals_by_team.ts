import {
  appendSportmonksQuery,
  buildSportmonksHeaders,
  handleSportmonksError,
  type SportmonksBaseParams,
} from '@/tools/sportmonks/types'
import {
  SPORTMONKS_FOOTBALL_BASE_URL,
  SPORTMONKS_RIVAL_PROPERTIES,
  type SportmonksRival,
} from '@/tools/sportmonks_football/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface SportmonksGetRivalsByTeamParams extends SportmonksBaseParams {
  teamId: string
}

export interface SportmonksGetRivalsByTeamResponse extends ToolResponse {
  output: {
    rivals: SportmonksRival[]
  }
}

export const sportmonksGetRivalsByTeamTool: ToolConfig<
  SportmonksGetRivalsByTeamParams,
  SportmonksGetRivalsByTeamResponse
> = {
  id: 'sportmonks_football_get_rivals_by_team',
  name: 'Get Rivals by Team',
  description: 'Retrieve rival teams for a team by team ID from Sportmonks',
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
      description: 'Semicolon-separated relations to enrich the response (e.g. team;rival)',
    },
  },

  request: {
    url: (params) => {
      const url = `${SPORTMONKS_FOOTBALL_BASE_URL}/rivals/teams/${encodeURIComponent(params.teamId.trim())}`
      return appendSportmonksQuery(url, params)
    },
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_rivals_by_team')
    }
    return {
      success: true,
      output: {
        rivals: Array.isArray(data.data) ? data.data : [],
      },
    }
  },

  outputs: {
    rivals: {
      type: 'array',
      description: 'Array of rival relationships for the team',
      items: { type: 'object', properties: SPORTMONKS_RIVAL_PROPERTIES },
    },
  },
}
