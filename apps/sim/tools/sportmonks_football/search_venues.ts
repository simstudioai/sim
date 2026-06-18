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
  SPORTMONKS_VENUE_PROPERTIES,
  type SportmonksVenue,
} from '@/tools/sportmonks_football/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface SportmonksSearchVenuesParams
  extends SportmonksBaseParams,
    SportmonksPaginationParams {
  query: string
}

export interface SportmonksSearchVenuesResponse extends ToolResponse {
  output: {
    venues: SportmonksVenue[]
    pagination?: SportmonksPagination | null
  }
}

export const sportmonksSearchVenuesTool: ToolConfig<
  SportmonksSearchVenuesParams,
  SportmonksSearchVenuesResponse
> = {
  id: 'sportmonks_football_search_venues',
  name: 'Search Venues',
  description: 'Search for football venues by name from Sportmonks',
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
      description: 'The venue name to search for (e.g. Celtic Park)',
    },
    include: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Semicolon-separated relations to enrich the response (e.g. country;city)',
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
      const url = `${SPORTMONKS_FOOTBALL_BASE_URL}/venues/search/${encodeURIComponent(params.query.trim())}`
      return appendSportmonksQuery(url, params)
    },
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'search_venues')
    }
    return {
      success: true,
      output: {
        venues: Array.isArray(data.data) ? data.data : [],
        pagination: data.pagination ?? null,
      },
    }
  },

  outputs: {
    venues: {
      type: 'array',
      description: 'Array of venue objects matching the search query',
      items: { type: 'object', properties: SPORTMONKS_VENUE_PROPERTIES },
    },
    pagination: SPORTMONKS_PAGINATION_OUTPUT,
  },
}
