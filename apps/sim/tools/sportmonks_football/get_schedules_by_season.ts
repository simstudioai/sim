import {
  appendSportmonksQuery,
  buildSportmonksHeaders,
  handleSportmonksError,
  type SportmonksBaseParams,
} from '@/tools/sportmonks/types'
import { SPORTMONKS_FOOTBALL_BASE_URL } from '@/tools/sportmonks_football/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface SportmonksGetSchedulesBySeasonParams extends SportmonksBaseParams {
  seasonId: string
}

export interface SportmonksGetSchedulesBySeasonResponse extends ToolResponse {
  output: {
    schedules: unknown[]
  }
}

export const sportmonksGetSchedulesBySeasonTool: ToolConfig<
  SportmonksGetSchedulesBySeasonParams,
  SportmonksGetSchedulesBySeasonResponse
> = {
  id: 'sportmonks_football_get_schedules_by_season',
  name: 'Get Schedules by Season',
  description: 'Retrieve the full schedule (stages, rounds and fixtures) for a season by season ID',
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
  },

  request: {
    url: (params) => {
      const url = `${SPORTMONKS_FOOTBALL_BASE_URL}/schedules/seasons/${encodeURIComponent(params.seasonId.trim())}`
      return appendSportmonksQuery(url, params)
    },
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_schedules_by_season')
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
