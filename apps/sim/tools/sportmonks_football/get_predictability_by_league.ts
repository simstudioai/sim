import {
  appendSportmonksQuery,
  buildSportmonksHeaders,
  handleSportmonksError,
  SPORTMONKS_PAGINATION_OUTPUT,
  type SportmonksBaseParams,
  type SportmonksPagination,
  type SportmonksPaginationParams,
} from '@/tools/sportmonks/types'
import {
  SPORTMONKS_FOOTBALL_BASE_URL,
  SPORTMONKS_PREDICTABILITY_PROPERTIES,
  type SportmonksPredictability,
} from '@/tools/sportmonks_football/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface SportmonksGetPredictabilityByLeagueParams
  extends SportmonksBaseParams,
    SportmonksPaginationParams {
  leagueId: string
}

export interface SportmonksGetPredictabilityByLeagueResponse extends ToolResponse {
  output: {
    predictability: SportmonksPredictability[]
    pagination?: SportmonksPagination | null
  }
}

export const sportmonksGetPredictabilityByLeagueTool: ToolConfig<
  SportmonksGetPredictabilityByLeagueParams,
  SportmonksGetPredictabilityByLeagueResponse
> = {
  id: 'sportmonks_football_get_predictability_by_league',
  name: 'Get Predictability by League',
  description: 'Retrieve the predictions model performance for a league ID from Sportmonks',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Sportmonks API token',
    },
    leagueId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The unique id of the league',
    },
    include: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Semicolon-separated relations to enrich the response (e.g. type;league)',
    },
    filters: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filters to apply (e.g. predictabilityTypes:245)',
    },
    per_page: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of results per page (max 50, default 25)',
    },
    page: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page number to retrieve',
    },
    order: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Order direction (asc or desc)',
    },
  },

  request: {
    url: (params) => {
      const url = `${SPORTMONKS_FOOTBALL_BASE_URL}/predictions/predictability/leagues/${encodeURIComponent(params.leagueId.trim())}`
      return appendSportmonksQuery(url, params)
    },
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_predictability_by_league')
    }
    return {
      success: true,
      output: {
        predictability: Array.isArray(data.data) ? data.data : [],
        pagination: data.pagination ?? null,
      },
    }
  },

  outputs: {
    predictability: {
      type: 'array',
      description: 'Array of predictability records for the league',
      items: { type: 'object', properties: SPORTMONKS_PREDICTABILITY_PROPERTIES },
    },
    pagination: SPORTMONKS_PAGINATION_OUTPUT,
  },
}
