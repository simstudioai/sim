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
  SPORTMONKS_REGION_PROPERTIES,
  type SportmonksRegion,
} from '@/tools/sportmonks_core/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface SportmonksGetRegionsParams
  extends SportmonksBaseParams,
    SportmonksPaginationParams {}

export interface SportmonksGetRegionsResponse extends ToolResponse {
  output: {
    regions: SportmonksRegion[]
    pagination?: SportmonksPagination | null
  }
}

export const sportmonksCoreGetRegionsTool: ToolConfig<
  SportmonksGetRegionsParams,
  SportmonksGetRegionsResponse
> = {
  id: 'sportmonks_core_get_regions',
  name: 'Get Regions',
  description: 'Retrieve all regions from the Sportmonks Core API',
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
      description: 'Semicolon-separated relations to enrich the response (e.g. country;cities)',
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
    url: (params) => appendSportmonksQuery(`${SPORTMONKS_CORE_BASE_URL}/regions`, params),
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_regions')
    }
    return {
      success: true,
      output: {
        regions: Array.isArray(data.data) ? data.data : [],
        pagination: data.pagination ?? null,
      },
    }
  },

  outputs: {
    regions: {
      type: 'array',
      description: 'Array of region objects',
      items: { type: 'object', properties: SPORTMONKS_REGION_PROPERTIES },
    },
    pagination: SPORTMONKS_PAGINATION_OUTPUT,
  },
}
