import {
  appendSportmonksQuery,
  buildSportmonksHeaders,
  handleSportmonksError,
  type SportmonksBaseParams,
} from '@/tools/sportmonks/types'
import {
  SPORTMONKS_MOTORSPORT_BASE_URL,
  SPORTMONKS_MS_TEAM_PROPERTIES,
  type SportmonksMsTeam,
} from '@/tools/sportmonks_motorsport/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface SportmonksMsGetTeamParams extends SportmonksBaseParams {
  teamId: string
}

export interface SportmonksMsGetTeamResponse extends ToolResponse {
  output: {
    team: SportmonksMsTeam | null
  }
}

export const sportmonksMotorsportGetTeamTool: ToolConfig<
  SportmonksMsGetTeamParams,
  SportmonksMsGetTeamResponse
> = {
  id: 'sportmonks_motorsport_get_team',
  name: 'Get Team by ID',
  description: 'Retrieve a single motorsport team (constructor) by its ID from Sportmonks',
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
      description: 'The unique id of the team (constructor)',
    },
    include: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Semicolon-separated relations to enrich the response (e.g. country;drivers)',
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
      const url = `${SPORTMONKS_MOTORSPORT_BASE_URL}/teams/${encodeURIComponent(params.teamId.trim())}`
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
      description: 'The requested team (constructor) object',
      properties: SPORTMONKS_MS_TEAM_PROPERTIES,
    },
  },
}
