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
  SPORTMONKS_CORE_BASE_URL,
  SPORTMONKS_TYPE_PROPERTIES,
  type SportmonksType,
} from '@/tools/sportmonks_core/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface SportmonksGetTypesParams
  extends SportmonksBaseParams,
    SportmonksPaginationParams {}

export interface SportmonksGetTypesResponse extends ToolResponse {
  output: {
    types: SportmonksType[]
    pagination?: SportmonksPagination | null
  }
}

export const sportmonksCoreGetTypesTool: ToolConfig<
  SportmonksGetTypesParams,
  SportmonksGetTypesResponse
> = {
  id: 'sportmonks_core_get_types',
  name: 'Get Types',
  description:
    'Retrieve all types (reference data describing events, statistics, positions, etc.) from the Sportmonks Core API',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Sportmonks API token',
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
    url: (params) => appendSportmonksQuery(`${SPORTMONKS_CORE_BASE_URL}/types`, params),
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_types')
    }
    return {
      success: true,
      output: {
        types: Array.isArray(data.data) ? data.data : [],
        pagination: data.pagination ?? null,
      },
    }
  },

  outputs: {
    types: {
      type: 'array',
      description: 'Array of type objects',
      items: { type: 'object', properties: SPORTMONKS_TYPE_PROPERTIES },
    },
    pagination: SPORTMONKS_PAGINATION_OUTPUT,
  },
}
