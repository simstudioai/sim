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
  SPORTMONKS_MOTORSPORT_BASE_URL,
  SPORTMONKS_MS_DRIVER_PROPERTIES,
  type SportmonksMsDriver,
} from '@/tools/sportmonks_motorsport/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface SportmonksMsGetDriversParams
  extends SportmonksBaseParams,
    SportmonksPaginationParams {}

export interface SportmonksMsGetDriversResponse extends ToolResponse {
  output: {
    drivers: SportmonksMsDriver[]
    pagination?: SportmonksPagination | null
  }
}

export const sportmonksMotorsportGetDriversTool: ToolConfig<
  SportmonksMsGetDriversParams,
  SportmonksMsGetDriversResponse
> = {
  id: 'sportmonks_motorsport_get_drivers',
  name: 'Get Drivers',
  description: 'Retrieve all motorsport drivers from Sportmonks',
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
      description: 'Semicolon-separated relations to enrich the response (e.g. country;teams)',
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
    url: (params) => appendSportmonksQuery(`${SPORTMONKS_MOTORSPORT_BASE_URL}/drivers`, params),
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_drivers')
    }
    return {
      success: true,
      output: {
        drivers: Array.isArray(data.data) ? data.data : [],
        pagination: data.pagination ?? null,
      },
    }
  },

  outputs: {
    drivers: {
      type: 'array',
      description: 'Array of driver objects',
      items: { type: 'object', properties: SPORTMONKS_MS_DRIVER_PROPERTIES },
    },
    pagination: SPORTMONKS_PAGINATION_OUTPUT,
  },
}
