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
  SPORTMONKS_CONTINENT_PROPERTIES,
  SPORTMONKS_CORE_BASE_URL,
  type SportmonksContinent,
} from '@/tools/sportmonks_core/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface SportmonksGetContinentsParams
  extends SportmonksBaseParams,
    SportmonksPaginationParams {}

export interface SportmonksGetContinentsResponse extends ToolResponse {
  output: {
    continents: SportmonksContinent[]
    pagination?: SportmonksPagination | null
  }
}

export const sportmonksCoreGetContinentsTool: ToolConfig<
  SportmonksGetContinentsParams,
  SportmonksGetContinentsResponse
> = {
  id: 'sportmonks_core_get_continents',
  name: 'Get Continents',
  description: 'Retrieve all continents from the Sportmonks Core API',
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
      description: 'Semicolon-separated relations to enrich the response (e.g. countries)',
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
    url: (params) => appendSportmonksQuery(`${SPORTMONKS_CORE_BASE_URL}/continents`, params),
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_continents')
    }
    return {
      success: true,
      output: {
        continents: Array.isArray(data.data) ? data.data : [],
        pagination: data.pagination ?? null,
      },
    }
  },

  outputs: {
    continents: {
      type: 'array',
      description: 'Array of continent objects',
      items: { type: 'object', properties: SPORTMONKS_CONTINENT_PROPERTIES },
    },
    pagination: SPORTMONKS_PAGINATION_OUTPUT,
  },
}
