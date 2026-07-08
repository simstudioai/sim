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
  SPORTMONKS_COACH_PROPERTIES,
  SPORTMONKS_FOOTBALL_BASE_URL,
  type SportmonksCoach,
} from '@/tools/sportmonks_football/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface SportmonksGetCoachesByCountryParams
  extends SportmonksBaseParams,
    SportmonksPaginationParams {
  countryId: string
}

export interface SportmonksGetCoachesByCountryResponse extends ToolResponse {
  output: {
    coaches: SportmonksCoach[]
    pagination?: SportmonksPagination | null
  }
}

export const sportmonksGetCoachesByCountryTool: ToolConfig<
  SportmonksGetCoachesByCountryParams,
  SportmonksGetCoachesByCountryResponse
> = {
  id: 'sportmonks_football_get_coaches_by_country',
  name: 'Get Coaches by Country',
  description: 'Retrieve all coaches for a country ID from Sportmonks',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Sportmonks API token',
    },
    countryId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The unique id of the country',
    },
    include: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Semicolon-separated relations to enrich the response (e.g. country;nationality)',
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
      const url = `${SPORTMONKS_FOOTBALL_BASE_URL}/coaches/countries/${encodeURIComponent(params.countryId.trim())}`
      return appendSportmonksQuery(url, params)
    },
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_coaches_by_country')
    }
    return {
      success: true,
      output: {
        coaches: Array.isArray(data.data) ? data.data : [],
        pagination: data.pagination ?? null,
      },
    }
  },

  outputs: {
    coaches: {
      type: 'array',
      description: 'Array of coach objects for the country',
      items: { type: 'object', properties: SPORTMONKS_COACH_PROPERTIES },
    },
    pagination: SPORTMONKS_PAGINATION_OUTPUT,
  },
}
