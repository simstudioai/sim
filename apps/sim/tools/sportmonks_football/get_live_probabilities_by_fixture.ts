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
  SPORTMONKS_LIVE_PROBABILITY_PROPERTIES,
  type SportmonksLiveProbability,
} from '@/tools/sportmonks_football/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface SportmonksGetLiveProbabilitiesByFixtureParams
  extends SportmonksBaseParams,
    SportmonksPaginationParams {
  fixtureId: string
}

export interface SportmonksGetLiveProbabilitiesByFixtureResponse extends ToolResponse {
  output: {
    predictions: SportmonksLiveProbability[]
    pagination?: SportmonksPagination | null
  }
}

export const sportmonksGetLiveProbabilitiesByFixtureTool: ToolConfig<
  SportmonksGetLiveProbabilitiesByFixtureParams,
  SportmonksGetLiveProbabilitiesByFixtureResponse
> = {
  id: 'sportmonks_football_get_live_probabilities_by_fixture',
  name: 'Get Live Probabilities by Fixture',
  description:
    'Retrieve all live (in-play) prediction probabilities for a fixture ID from Sportmonks',
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
      const url = `${SPORTMONKS_FOOTBALL_BASE_URL}/predictions/live/probabilities/fixtures/${encodeURIComponent(params.fixtureId.trim())}`
      return appendSportmonksQuery(url, params)
    },
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_live_probabilities_by_fixture')
    }
    return {
      success: true,
      output: {
        predictions: Array.isArray(data.data) ? data.data : [],
        pagination: data.pagination ?? null,
      },
    }
  },

  outputs: {
    predictions: {
      type: 'array',
      description: 'Array of live probability prediction objects for the fixture',
      items: { type: 'object', properties: SPORTMONKS_LIVE_PROBABILITY_PROPERTIES },
    },
    pagination: SPORTMONKS_PAGINATION_OUTPUT,
  },
}
