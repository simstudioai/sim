import {
  appendSportmonksQuery,
  buildSportmonksHeaders,
  handleSportmonksError,
  type SportmonksBaseParams,
} from '@/tools/sportmonks/types'
import {
  SPORTMONKS_FOOTBALL_BASE_URL,
  SPORTMONKS_REFEREE_PROPERTIES,
  type SportmonksReferee,
} from '@/tools/sportmonks_football/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface SportmonksGetRefereeParams extends SportmonksBaseParams {
  refereeId: string
}

export interface SportmonksGetRefereeResponse extends ToolResponse {
  output: {
    referee: SportmonksReferee | null
  }
}

export const sportmonksGetRefereeTool: ToolConfig<
  SportmonksGetRefereeParams,
  SportmonksGetRefereeResponse
> = {
  id: 'sportmonks_football_get_referee',
  name: 'Get Referee by ID',
  description: 'Retrieve a single football referee by their ID from Sportmonks',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Sportmonks API token',
    },
    refereeId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The unique id of the referee',
    },
    include: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Semicolon-separated relations to enrich the response (e.g. country;statistics)',
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
      const url = `${SPORTMONKS_FOOTBALL_BASE_URL}/referees/${encodeURIComponent(params.refereeId.trim())}`
      return appendSportmonksQuery(url, params)
    },
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_referee')
    }
    return {
      success: true,
      output: {
        referee: data.data ?? null,
      },
    }
  },

  outputs: {
    referee: {
      type: 'object',
      description: 'The requested referee object',
      properties: SPORTMONKS_REFEREE_PROPERTIES,
    },
  },
}
