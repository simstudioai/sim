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

export interface SportmonksGetVenuesParams
  extends SportmonksBaseParams,
    SportmonksPaginationParams {}

export interface SportmonksGetVenuesResponse extends ToolResponse {
  output: {
    venues: SportmonksVenue[]
    pagination?: SportmonksPagination | null
  }
}

export const sportmonksGetVenuesTool: ToolConfig<
  SportmonksGetVenuesParams,
  SportmonksGetVenuesResponse
> = {
  id: 'sportmonks_football_get_venues',
  name: 'Get Venues',
  description: 'Retrieve all football venues available within your Sportmonks subscription',
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
      description: 'Semicolon-separated relations to enrich the response (e.g. country;city)',
    },
    filters: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filters to apply (e.g. venueCountries:98)',
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
    url: (params) => appendSportmonksQuery(`${SPORTMONKS_FOOTBALL_BASE_URL}/venues`, params),
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_venues')
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
      description: 'Array of venue objects',
      items: { type: 'object', properties: SPORTMONKS_VENUE_PROPERTIES },
    },
    pagination: SPORTMONKS_PAGINATION_OUTPUT,
  },
}
