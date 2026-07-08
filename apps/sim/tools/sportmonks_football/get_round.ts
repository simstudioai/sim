import {
  appendSportmonksQuery,
  buildSportmonksHeaders,
  handleSportmonksError,
  type SportmonksBaseParams,
} from '@/tools/sportmonks/types'
import {
  SPORTMONKS_FOOTBALL_BASE_URL,
  SPORTMONKS_ROUND_PROPERTIES,
  type SportmonksRound,
} from '@/tools/sportmonks_football/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface SportmonksGetRoundParams extends SportmonksBaseParams {
  roundId: string
}

export interface SportmonksGetRoundResponse extends ToolResponse {
  output: {
    round: SportmonksRound | null
  }
}

export const sportmonksGetRoundTool: ToolConfig<
  SportmonksGetRoundParams,
  SportmonksGetRoundResponse
> = {
  id: 'sportmonks_football_get_round',
  name: 'Get Round by ID',
  description: 'Retrieve a single football round by its ID from Sportmonks',
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
        'Semicolon-separated relations to enrich the response (e.g. league;season;stage;fixtures)',
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
      const url = `${SPORTMONKS_FOOTBALL_BASE_URL}/rounds/${encodeURIComponent(params.roundId.trim())}`
      return appendSportmonksQuery(url, params)
    },
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_round')
    }
    return {
      success: true,
      output: {
        round: data.data ?? null,
      },
    }
  },

  outputs: {
    round: {
      type: 'object',
      description: 'The requested round object',
      properties: SPORTMONKS_ROUND_PROPERTIES,
    },
  },
}
