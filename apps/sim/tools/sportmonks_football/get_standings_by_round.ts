import {
  appendSportmonksQuery,
  buildSportmonksHeaders,
  handleSportmonksError,
  type SportmonksBaseParams,
} from '@/tools/sportmonks/types'
import {
  SPORTMONKS_FOOTBALL_BASE_URL,
  SPORTMONKS_STANDING_PROPERTIES,
  type SportmonksStanding,
} from '@/tools/sportmonks_football/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface SportmonksGetStandingsByRoundParams extends SportmonksBaseParams {
  roundId: string
}

export interface SportmonksGetStandingsByRoundResponse extends ToolResponse {
  output: {
    standings: SportmonksStanding[]
  }
}

export const sportmonksGetStandingsByRoundTool: ToolConfig<
  SportmonksGetStandingsByRoundParams,
  SportmonksGetStandingsByRoundResponse
> = {
  id: 'sportmonks_football_get_standings_by_round',
  name: 'Get Standings by Round',
  description: 'Retrieve the full standing table for a round ID from Sportmonks',
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
        'Semicolon-separated relations to enrich the response (e.g. participant;details)',
    },
    filters: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filters to apply (e.g. standingGroups:246697)',
    },
  },

  request: {
    url: (params) => {
      const url = `${SPORTMONKS_FOOTBALL_BASE_URL}/standings/rounds/${encodeURIComponent(params.roundId.trim())}`
      return appendSportmonksQuery(url, params)
    },
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_standings_by_round')
    }
    return {
      success: true,
      output: {
        standings: Array.isArray(data.data) ? data.data : [],
      },
    }
  },

  outputs: {
    standings: {
      type: 'array',
      description: 'Array of standing entries for the round',
      items: { type: 'object', properties: SPORTMONKS_STANDING_PROPERTIES },
    },
  },
}
