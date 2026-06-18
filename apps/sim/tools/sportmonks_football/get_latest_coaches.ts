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

export interface SportmonksGetLatestCoachesParams
  extends SportmonksBaseParams,
    SportmonksPaginationParams {}

export interface SportmonksGetLatestCoachesResponse extends ToolResponse {
  output: {
    coaches: SportmonksCoach[]
    pagination?: SportmonksPagination | null
  }
}

export const sportmonksGetLatestCoachesTool: ToolConfig<
  SportmonksGetLatestCoachesParams,
  SportmonksGetLatestCoachesResponse
> = {
  id: 'sportmonks_football_get_latest_coaches',
  name: 'Get Last Updated Coaches',
  description: 'Retrieve all coaches that have received updates in the past two hours',
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
    url: (params) =>
      appendSportmonksQuery(`${SPORTMONKS_FOOTBALL_BASE_URL}/coaches/latest`, params),
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_latest_coaches')
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
      description: 'Array of recently updated coach objects',
      items: { type: 'object', properties: SPORTMONKS_COACH_PROPERTIES },
    },
    pagination: SPORTMONKS_PAGINATION_OUTPUT,
  },
}
