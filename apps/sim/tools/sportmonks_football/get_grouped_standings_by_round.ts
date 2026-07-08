import {
  appendSportmonksQuery,
  buildSportmonksHeaders,
  handleSportmonksError,
  type SportmonksBaseParams,
} from '@/tools/sportmonks/types'
import { SPORTMONKS_FOOTBALL_BASE_URL } from '@/tools/sportmonks_football/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface SportmonksGetGroupedStandingsByRoundParams extends SportmonksBaseParams {
  roundId: string
}

export interface SportmonksGetGroupedStandingsByRoundResponse extends ToolResponse {
  output: {
    standings: unknown[]
  }
}

export const sportmonksGetGroupedStandingsByRoundTool: ToolConfig<
  SportmonksGetGroupedStandingsByRoundParams,
  SportmonksGetGroupedStandingsByRoundResponse
> = {
  id: 'sportmonks_football_get_grouped_standings_by_round',
  name: 'Get Grouped Standings by Round',
  description:
    'Retrieve the standing table for a round ID grouped by group where applicable from Sportmonks',
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
      const url = `${SPORTMONKS_FOOTBALL_BASE_URL}/standings/rounds/${encodeURIComponent(params.roundId.trim())}/grouped`
      return appendSportmonksQuery(url, params)
    },
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_grouped_standings_by_round')
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
      type: 'json',
      description:
        'Standings for the round: an array of groups (each with id, name and a standings array) when groups exist, otherwise a flat array of standing entries',
    },
  },
}
