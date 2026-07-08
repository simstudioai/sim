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

export interface SportmonksSearchRegionsParams
  extends SportmonksBaseParams,
    SportmonksPaginationParams {
  query: string
}

export interface SportmonksSearchRegionsResponse extends ToolResponse {
  output: {
    regions: SportmonksRegion[]
    pagination?: SportmonksPagination | null
  }
}

export const sportmonksCoreSearchRegionsTool: ToolConfig<
  SportmonksSearchRegionsParams,
  SportmonksSearchRegionsResponse
> = {
  id: 'sportmonks_core_search_regions',
  name: 'Search Regions',
  description: 'Search for regions by name from the Sportmonks Core API',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Sportmonks API token',
    },
    query: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The region name to search for (e.g. Utrecht)',
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
    url: (params) => {
      const url = `${SPORTMONKS_CORE_BASE_URL}/regions/search/${encodeURIComponent(params.query.trim())}`
      return appendSportmonksQuery(url, params)
    },
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'search_regions')
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
      description: 'Array of region objects matching the search query',
      items: { type: 'object', properties: SPORTMONKS_REGION_PROPERTIES },
    },
    pagination: SPORTMONKS_PAGINATION_OUTPUT,
  },
}
