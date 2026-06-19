import {
  appendSportmonksQuery,
  buildSportmonksHeaders,
  handleSportmonksError,
  type SportmonksBaseParams,
} from '@/tools/sportmonks/types'
import {
  SPORTMONKS_FOOTBALL_BASE_URL,
  SPORTMONKS_SEASON_PROPERTIES,
  type SportmonksSeason,
} from '@/tools/sportmonks_football/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface SportmonksGetSeasonParams extends SportmonksBaseParams {
  seasonId: string
}

export interface SportmonksGetSeasonResponse extends ToolResponse {
  output: {
    season: SportmonksSeason | null
  }
}

export const sportmonksGetSeasonTool: ToolConfig<
  SportmonksGetSeasonParams,
  SportmonksGetSeasonResponse
> = {
  id: 'sportmonks_football_get_season',
  name: 'Get Season by ID',
  description: 'Retrieve a single football season by its ID from Sportmonks',
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
        'Semicolon-separated relations to enrich the response (e.g. league;stages;fixtures)',
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
      const url = `${SPORTMONKS_FOOTBALL_BASE_URL}/seasons/${encodeURIComponent(params.seasonId.trim())}`
      return appendSportmonksQuery(url, params)
    },
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_season')
    }
    return {
      success: true,
      output: {
        season: data.data ?? null,
      },
    }
  },

  outputs: {
    season: {
      type: 'object',
      description: 'The requested season object',
      properties: SPORTMONKS_SEASON_PROPERTIES,
    },
  },
}
