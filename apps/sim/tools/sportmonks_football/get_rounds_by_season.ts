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

export interface SportmonksGetRoundsBySeasonParams extends SportmonksBaseParams {
  seasonId: string
}

export interface SportmonksGetRoundsBySeasonResponse extends ToolResponse {
  output: {
    rounds: SportmonksRound[]
  }
}

export const sportmonksGetRoundsBySeasonTool: ToolConfig<
  SportmonksGetRoundsBySeasonParams,
  SportmonksGetRoundsBySeasonResponse
> = {
  id: 'sportmonks_football_get_rounds_by_season',
  name: 'Get Rounds by Season',
  description: 'Retrieve all rounds for a season ID from Sportmonks',
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
    include: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Semicolon-separated relations to enrich the response (e.g. league;stage)',
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
      const url = `${SPORTMONKS_FOOTBALL_BASE_URL}/rounds/seasons/${encodeURIComponent(params.seasonId.trim())}`
      return appendSportmonksQuery(url, params)
    },
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_rounds_by_season')
    }
    return {
      success: true,
      output: {
        rounds: Array.isArray(data.data) ? data.data : [],
      },
    }
  },

  outputs: {
    rounds: {
      type: 'array',
      description: 'Array of round objects for the season',
      items: { type: 'object', properties: SPORTMONKS_ROUND_PROPERTIES },
    },
  },
}
