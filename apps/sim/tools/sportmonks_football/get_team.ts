import {
  appendSportmonksQuery,
  buildSportmonksHeaders,
  handleSportmonksError,
  type SportmonksBaseParams,
} from '@/tools/sportmonks/types'
import {
  SPORTMONKS_FOOTBALL_BASE_URL,
  SPORTMONKS_TEAM_PROPERTIES,
  type SportmonksTeam,
} from '@/tools/sportmonks_football/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface SportmonksGetTeamParams extends SportmonksBaseParams {
  teamId: string
}

export interface SportmonksGetTeamResponse extends ToolResponse {
  output: {
    team: SportmonksTeam | null
  }
}

export const sportmonksGetTeamTool: ToolConfig<SportmonksGetTeamParams, SportmonksGetTeamResponse> =
  {
    id: 'sportmonks_football_get_team',
    name: 'Get Team by ID',
    description: 'Retrieve a single football team by its ID from Sportmonks',
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
          'Semicolon-separated relations to enrich the response (e.g. country;venue;coaches;players.player)',
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
        const url = `${SPORTMONKS_FOOTBALL_BASE_URL}/teams/${encodeURIComponent(params.teamId.trim())}`
        return appendSportmonksQuery(url, params)
      },
      method: 'GET',
      headers: (params) => buildSportmonksHeaders(params.apiKey),
    },

    transformResponse: async (response: Response) => {
      const data = await response.json()
      if (!response.ok) {
        handleSportmonksError(data, response.status, 'get_team')
      }
      return {
        success: true,
        output: {
          team: data.data ?? null,
        },
      }
    },

    outputs: {
      team: {
        type: 'object',
        description: 'The requested team object',
        properties: SPORTMONKS_TEAM_PROPERTIES,
      },
    },
  }
