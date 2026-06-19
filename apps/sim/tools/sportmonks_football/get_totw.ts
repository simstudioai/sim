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
  SPORTMONKS_TOTW_PROPERTIES,
  type SportmonksTotw,
} from '@/tools/sportmonks_football/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface SportmonksGetTotwParams extends SportmonksBaseParams, SportmonksPaginationParams {}

export interface SportmonksGetTotwResponse extends ToolResponse {
  output: {
    totw: SportmonksTotw[]
    pagination?: SportmonksPagination | null
  }
}

export const sportmonksGetTotwTool: ToolConfig<SportmonksGetTotwParams, SportmonksGetTotwResponse> =
  {
    id: 'sportmonks_football_get_totw',
    name: 'Get All Team of the Week',
    description: 'Retrieve all available Team of the Week (TOTW) entries from Sportmonks',
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
          'Semicolon-separated relations to enrich the response (e.g. fixture;team;player;round)',
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
        appendSportmonksQuery(`${SPORTMONKS_FOOTBALL_BASE_URL}/team-of-the-week`, params),
      method: 'GET',
      headers: (params) => buildSportmonksHeaders(params.apiKey),
    },

    transformResponse: async (response: Response) => {
      const data = await response.json()
      if (!response.ok) {
        handleSportmonksError(data, response.status, 'get_totw')
      }
      return {
        success: true,
        output: {
          totw: Array.isArray(data.data) ? data.data : [],
          pagination: data.pagination ?? null,
        },
      }
    },

    outputs: {
      totw: {
        type: 'array',
        description: 'Array of Team of the Week entries',
        items: { type: 'object', properties: SPORTMONKS_TOTW_PROPERTIES },
      },
      pagination: SPORTMONKS_PAGINATION_OUTPUT,
    },
  }
