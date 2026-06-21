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
  SPORTMONKS_REFEREE_PROPERTIES,
  type SportmonksReferee,
} from '@/tools/sportmonks_football/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface SportmonksGetRefereesByCountryParams
  extends SportmonksBaseParams,
    SportmonksPaginationParams {
  countryId: string
}

export interface SportmonksGetRefereesByCountryResponse extends ToolResponse {
  output: {
    referees: SportmonksReferee[]
    pagination?: SportmonksPagination | null
  }
}

export const sportmonksGetRefereesByCountryTool: ToolConfig<
  SportmonksGetRefereesByCountryParams,
  SportmonksGetRefereesByCountryResponse
> = {
  id: 'sportmonks_football_get_referees_by_country',
  name: 'Get Referees by Country',
  description: 'Retrieve all referees for a country ID from Sportmonks',
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
      const url = `${SPORTMONKS_FOOTBALL_BASE_URL}/referees/countries/${encodeURIComponent(params.countryId.trim())}`
      return appendSportmonksQuery(url, params)
    },
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_referees_by_country')
    }
    return {
      success: true,
      output: {
        referees: Array.isArray(data.data) ? data.data : [],
        pagination: data.pagination ?? null,
      },
    }
  },

  outputs: {
    referees: {
      type: 'array',
      description: 'Array of referee objects for the country',
      items: { type: 'object', properties: SPORTMONKS_REFEREE_PROPERTIES },
    },
    pagination: SPORTMONKS_PAGINATION_OUTPUT,
  },
}
