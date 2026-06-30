import {
  appendSportmonksQuery,
  buildSportmonksHeaders,
  handleSportmonksError,
  type SportmonksBaseParams,
} from '@/tools/sportmonks/types'
import {
  SPORTMONKS_COACH_PROPERTIES,
  SPORTMONKS_FOOTBALL_BASE_URL,
  type SportmonksCoach,
} from '@/tools/sportmonks_football/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface SportmonksGetCoachParams extends SportmonksBaseParams {
  coachId: string
}

export interface SportmonksGetCoachResponse extends ToolResponse {
  output: {
    coach: SportmonksCoach | null
  }
}

export const sportmonksGetCoachTool: ToolConfig<
  SportmonksGetCoachParams,
  SportmonksGetCoachResponse
> = {
  id: 'sportmonks_football_get_coach',
  name: 'Get Coach by ID',
  description: 'Retrieve a single football coach by their ID from Sportmonks',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Sportmonks API token',
    },
    coachId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The unique id of the coach',
    },
    include: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Semicolon-separated relations to enrich the response (e.g. country;teams;statistics)',
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
      const url = `${SPORTMONKS_FOOTBALL_BASE_URL}/coaches/${encodeURIComponent(params.coachId.trim())}`
      return appendSportmonksQuery(url, params)
    },
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_coach')
    }
    return {
      success: true,
      output: {
        coach: data.data ?? null,
      },
    }
  },

  outputs: {
    coach: {
      type: 'object',
      description: 'The requested coach object',
      properties: SPORTMONKS_COACH_PROPERTIES,
    },
  },
}
