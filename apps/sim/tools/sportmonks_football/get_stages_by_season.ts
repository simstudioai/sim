import {
  appendSportmonksQuery,
  buildSportmonksHeaders,
  handleSportmonksError,
  type SportmonksBaseParams,
} from '@/tools/sportmonks/types'
import {
  SPORTMONKS_FOOTBALL_BASE_URL,
  SPORTMONKS_STAGE_PROPERTIES,
  type SportmonksStage,
} from '@/tools/sportmonks_football/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface SportmonksGetStagesBySeasonParams extends SportmonksBaseParams {
  seasonId: string
}

export interface SportmonksGetStagesBySeasonResponse extends ToolResponse {
  output: {
    stages: SportmonksStage[]
  }
}

export const sportmonksGetStagesBySeasonTool: ToolConfig<
  SportmonksGetStagesBySeasonParams,
  SportmonksGetStagesBySeasonResponse
> = {
  id: 'sportmonks_football_get_stages_by_season',
  name: 'Get Stages by Season',
  description: 'Retrieve all stages for a season ID from Sportmonks',
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
      description: 'Semicolon-separated relations to enrich the response (e.g. league;rounds)',
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
      const url = `${SPORTMONKS_FOOTBALL_BASE_URL}/stages/seasons/${encodeURIComponent(params.seasonId.trim())}`
      return appendSportmonksQuery(url, params)
    },
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_stages_by_season')
    }
    return {
      success: true,
      output: {
        stages: Array.isArray(data.data) ? data.data : [],
      },
    }
  },

  outputs: {
    stages: {
      type: 'array',
      description: 'Array of stage objects for the season',
      items: { type: 'object', properties: SPORTMONKS_STAGE_PROPERTIES },
    },
  },
}
