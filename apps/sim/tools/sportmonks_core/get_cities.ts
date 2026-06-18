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
  SPORTMONKS_CITY_PROPERTIES,
  SPORTMONKS_CORE_BASE_URL,
  type SportmonksCity,
} from '@/tools/sportmonks_core/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface SportmonksGetCitiesParams
  extends SportmonksBaseParams,
    SportmonksPaginationParams {}

export interface SportmonksGetCitiesResponse extends ToolResponse {
  output: {
    cities: SportmonksCity[]
    pagination?: SportmonksPagination | null
  }
}

export const sportmonksCoreGetCitiesTool: ToolConfig<
  SportmonksGetCitiesParams,
  SportmonksGetCitiesResponse
> = {
  id: 'sportmonks_core_get_cities',
  name: 'Get Cities',
  description: 'Retrieve all cities from the Sportmonks Core API',
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
      description: 'Semicolon-separated relations to enrich the response (e.g. region)',
    },
    filters: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filters to apply',
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
    url: (params) => appendSportmonksQuery(`${SPORTMONKS_CORE_BASE_URL}/cities`, params),
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_cities')
    }
    return {
      success: true,
      output: {
        cities: Array.isArray(data.data) ? data.data : [],
        pagination: data.pagination ?? null,
      },
    }
  },

  outputs: {
    cities: {
      type: 'array',
      description: 'Array of city objects',
      items: { type: 'object', properties: SPORTMONKS_CITY_PROPERTIES },
    },
    pagination: SPORTMONKS_PAGINATION_OUTPUT,
  },
}
