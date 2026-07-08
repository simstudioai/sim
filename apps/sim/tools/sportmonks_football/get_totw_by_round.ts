import {
  appendSportmonksQuery,
  buildSportmonksHeaders,
  handleSportmonksError,
  type SportmonksBaseParams,
} from '@/tools/sportmonks/types'
import {
  SPORTMONKS_FOOTBALL_BASE_URL,
  SPORTMONKS_TOTW_PROPERTIES,
  type SportmonksTotw,
} from '@/tools/sportmonks_football/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface SportmonksGetTotwByRoundParams extends SportmonksBaseParams {
  roundId: string
}

export interface SportmonksGetTotwByRoundResponse extends ToolResponse {
  output: {
    totw: SportmonksTotw[]
  }
}

export const sportmonksGetTotwByRoundTool: ToolConfig<
  SportmonksGetTotwByRoundParams,
  SportmonksGetTotwByRoundResponse
> = {
  id: 'sportmonks_football_get_totw_by_round',
  name: 'Get Team of the Week by Round',
  description: 'Retrieve the Team of the Week (TOTW) for a round ID from Sportmonks',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Sportmonks API token',
    },
    roundId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The unique id of the round',
    },
    include: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Semicolon-separated relations to enrich the response (e.g. fixture;team;player;round)',
    },
  },

  request: {
    url: (params) => {
      const url = `${SPORTMONKS_FOOTBALL_BASE_URL}/team-of-the-week/rounds/${encodeURIComponent(params.roundId.trim())}`
      return appendSportmonksQuery(url, params)
    },
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_totw_by_round')
    }
    return {
      success: true,
      output: {
        totw: Array.isArray(data.data) ? data.data : [],
      },
    }
  },

  outputs: {
    totw: {
      type: 'array',
      description: 'Array of Team of the Week entries for the round',
      items: { type: 'object', properties: SPORTMONKS_TOTW_PROPERTIES },
    },
  },
}
