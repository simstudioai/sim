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

export interface SportmonksGetStandingsBySeasonParams extends SportmonksBaseParams {
  seasonId: string
}

export interface SportmonksGetStandingsBySeasonResponse extends ToolResponse {
  output: {
    standings: SportmonksStanding[]
  }
}

export const sportmonksGetStandingsBySeasonTool: ToolConfig<
  SportmonksGetStandingsBySeasonParams,
  SportmonksGetStandingsBySeasonResponse
> = {
  id: 'sportmonks_football_get_standings_by_season',
  name: 'Get Standings by Season',
  description: 'Retrieve the full league standings table for a season by season ID from Sportmonks',
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
      description:
        'Semicolon-separated relations to enrich the response (e.g. participant;details;form)',
    },
    filters: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filters to apply (e.g. standingStages:77453568)',
    },
  },

  request: {
    url: (params) => {
      const url = `${SPORTMONKS_FOOTBALL_BASE_URL}/standings/seasons/${encodeURIComponent(params.seasonId.trim())}`
      return appendSportmonksQuery(url, params)
    },
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_standings_by_season')
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
      description: 'Array of standing entries for the season',
      items: { type: 'object', properties: SPORTMONKS_STANDING_PROPERTIES },
    },
  },
}
