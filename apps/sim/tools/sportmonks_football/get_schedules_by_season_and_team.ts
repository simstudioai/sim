import {
  appendSportmonksQuery,
  buildSportmonksHeaders,
  handleSportmonksError,
  type SportmonksBaseParams,
} from '@/tools/sportmonks/types'
import { SPORTMONKS_FOOTBALL_BASE_URL } from '@/tools/sportmonks_football/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface SportmonksGetSchedulesBySeasonAndTeamParams extends SportmonksBaseParams {
  seasonId: string
  teamId: string
}

export interface SportmonksGetSchedulesBySeasonAndTeamResponse extends ToolResponse {
  output: {
    schedules: unknown[]
  }
}

export const sportmonksGetSchedulesBySeasonAndTeamTool: ToolConfig<
  SportmonksGetSchedulesBySeasonAndTeamParams,
  SportmonksGetSchedulesBySeasonAndTeamResponse
> = {
  id: 'sportmonks_football_get_schedules_by_season_and_team',
  name: 'Get Schedules by Season and Team',
  description: 'Retrieve the full season schedule for a specific team by season ID and team ID',
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
  },

  request: {
    url: (params) => {
      const url = `${SPORTMONKS_FOOTBALL_BASE_URL}/schedules/seasons/${encodeURIComponent(
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
      handleSportmonksError(data, response.status, 'get_schedules_by_season_and_team')
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
        'Array of stages, each with nested rounds and their fixtures for the team in the season',
    },
  },
}
