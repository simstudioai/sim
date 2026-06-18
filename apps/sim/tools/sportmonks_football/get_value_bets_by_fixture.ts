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

export interface SportmonksGetValueBetsByFixtureParams
  extends SportmonksBaseParams,
    SportmonksPaginationParams {
  fixtureId: string
}

export interface SportmonksGetValueBetsByFixtureResponse extends ToolResponse {
  output: {
    valueBets: SportmonksPrediction[]
    pagination?: SportmonksPagination | null
  }
}

export const sportmonksGetValueBetsByFixtureTool: ToolConfig<
  SportmonksGetValueBetsByFixtureParams,
  SportmonksGetValueBetsByFixtureResponse
> = {
  id: 'sportmonks_football_get_value_bets_by_fixture',
  name: 'Get Value Bets by Fixture',
  description: 'Retrieve value bet predictions for a fixture by fixture ID from Sportmonks',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Sportmonks API token',
    },
    fixtureId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The unique id of the fixture',
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
    url: (params) => {
      const url = `${SPORTMONKS_FOOTBALL_BASE_URL}/predictions/value-bets/fixtures/${encodeURIComponent(params.fixtureId.trim())}`
      return appendSportmonksQuery(url, params)
    },
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_value_bets_by_fixture')
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
      description: 'Array of value bet prediction entries for the fixture',
      items: { type: 'object', properties: SPORTMONKS_PREDICTION_PROPERTIES },
    },
    pagination: SPORTMONKS_PAGINATION_OUTPUT,
  },
}
