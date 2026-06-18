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
  SPORTMONKS_PREDICTION_PROPERTIES,
  type SportmonksPrediction,
} from '@/tools/sportmonks_football/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface SportmonksGetValueBetsParams
  extends SportmonksBaseParams,
    SportmonksPaginationParams {}

export interface SportmonksGetValueBetsResponse extends ToolResponse {
  output: {
    valueBets: SportmonksPrediction[]
    pagination?: SportmonksPagination | null
  }
}

export const sportmonksGetValueBetsTool: ToolConfig<
  SportmonksGetValueBetsParams,
  SportmonksGetValueBetsResponse
> = {
  id: 'sportmonks_football_get_value_bets',
  name: 'Get Value Bets',
  description: 'Retrieve all value bets available within your Sportmonks subscription',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Sportmonks API token',
    },
    include: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Semicolon-separated relations to enrich the response (e.g. type;fixture)',
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
    url: (params) =>
      appendSportmonksQuery(`${SPORTMONKS_FOOTBALL_BASE_URL}/predictions/value-bets`, params),
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_value_bets')
    }
    return {
      success: true,
      output: {
        valueBets: Array.isArray(data.data) ? data.data : [],
        pagination: data.pagination ?? null,
      },
    }
  },

  outputs: {
    valueBets: {
      type: 'array',
      description: 'Array of value bet prediction objects',
      items: { type: 'object', properties: SPORTMONKS_PREDICTION_PROPERTIES },
    },
    pagination: SPORTMONKS_PAGINATION_OUTPUT,
  },
}
