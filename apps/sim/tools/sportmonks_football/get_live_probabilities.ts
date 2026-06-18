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

export interface SportmonksGetLiveProbabilitiesParams
  extends SportmonksBaseParams,
    SportmonksPaginationParams {}

export interface SportmonksGetLiveProbabilitiesResponse extends ToolResponse {
  output: {
    predictions: SportmonksLiveProbability[]
    pagination?: SportmonksPagination | null
  }
}

export const sportmonksGetLiveProbabilitiesTool: ToolConfig<
  SportmonksGetLiveProbabilitiesParams,
  SportmonksGetLiveProbabilitiesResponse
> = {
  id: 'sportmonks_football_get_live_probabilities',
  name: 'Get Live Probabilities',
  description: 'Retrieve all live (in-play) prediction probabilities from Sportmonks',
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
      appendSportmonksQuery(
        `${SPORTMONKS_FOOTBALL_BASE_URL}/predictions/live/probabilities`,
        params
      ),
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_live_probabilities')
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
      description: 'Array of live probability prediction objects',
      items: { type: 'object', properties: SPORTMONKS_LIVE_PROBABILITY_PROPERTIES },
    },
    pagination: SPORTMONKS_PAGINATION_OUTPUT,
  },
}
