import {
  appendSportmonksQuery,
  buildSportmonksHeaders,
  handleSportmonksError,
  type SportmonksBaseParams,
} from '@/tools/sportmonks/types'
import { SPORTMONKS_FOOTBALL_BASE_URL } from '@/tools/sportmonks_football/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface SportmonksGetSchedulesByTeamParams extends SportmonksBaseParams {
  teamId: string
}

export interface SportmonksGetSchedulesByTeamResponse extends ToolResponse {
  output: {
    schedules: unknown[]
  }
}

export const sportmonksGetSchedulesByTeamTool: ToolConfig<
  SportmonksGetSchedulesByTeamParams,
  SportmonksGetSchedulesByTeamResponse
> = {
  id: 'sportmonks_football_get_schedules_by_team',
  name: 'Get Schedules by Team',
  description: 'Retrieve the full schedule (stages, rounds and fixtures) for a team by team ID',
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
  },

  request: {
    url: (params) => {
      const url = `${SPORTMONKS_FOOTBALL_BASE_URL}/schedules/teams/${encodeURIComponent(params.teamId.trim())}`
      return appendSportmonksQuery(url, params)
    },
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_schedules_by_team')
    }
    return {
      success: true,
      output: {
        schedules: Array.isArray(data.data) ? data.data : [],
      },
    }
  },

  outputs: {
    schedules: {
      type: 'json',
      description:
        'Array of stages, each with nested rounds and their fixtures (participants, scores)',
    },
  },
}
