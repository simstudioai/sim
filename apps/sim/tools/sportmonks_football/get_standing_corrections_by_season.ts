import {
  appendSportmonksQuery,
  buildSportmonksHeaders,
  handleSportmonksError,
  type SportmonksBaseParams,
} from '@/tools/sportmonks/types'
import {
  SPORTMONKS_FOOTBALL_BASE_URL,
  SPORTMONKS_STANDING_CORRECTION_PROPERTIES,
  type SportmonksStandingCorrection,
} from '@/tools/sportmonks_football/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface SportmonksGetStandingCorrectionsBySeasonParams extends SportmonksBaseParams {
  seasonId: string
}

export interface SportmonksGetStandingCorrectionsBySeasonResponse extends ToolResponse {
  output: {
    corrections: SportmonksStandingCorrection[]
  }
}

export const sportmonksGetStandingCorrectionsBySeasonTool: ToolConfig<
  SportmonksGetStandingCorrectionsBySeasonParams,
  SportmonksGetStandingCorrectionsBySeasonResponse
> = {
  id: 'sportmonks_football_get_standing_corrections_by_season',
  name: 'Get Standing Corrections by Season',
  description: 'Retrieve point corrections (awarded or deducted) for a season ID from Sportmonks',
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
      description: 'Semicolon-separated relations to enrich the response (e.g. participant;stage)',
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
      const url = `${SPORTMONKS_FOOTBALL_BASE_URL}/standings/corrections/seasons/${encodeURIComponent(params.seasonId.trim())}`
      return appendSportmonksQuery(url, params)
    },
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_standing_corrections_by_season')
    }
    return {
      success: true,
      output: {
        corrections: Array.isArray(data.data) ? data.data : [],
      },
    }
  },

  outputs: {
    corrections: {
      type: 'array',
      description: 'Array of standing correction entries for the season',
      items: { type: 'object', properties: SPORTMONKS_STANDING_CORRECTION_PROPERTIES },
    },
  },
}
