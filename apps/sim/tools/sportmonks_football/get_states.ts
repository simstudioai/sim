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
  SPORTMONKS_STATE_PROPERTIES,
  type SportmonksState,
} from '@/tools/sportmonks_football/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface SportmonksGetStatesParams
  extends SportmonksBaseParams,
    SportmonksPaginationParams {}

export interface SportmonksGetStatesResponse extends ToolResponse {
  output: {
    states: SportmonksState[]
    pagination?: SportmonksPagination | null
  }
}

export const sportmonksGetStatesTool: ToolConfig<
  SportmonksGetStatesParams,
  SportmonksGetStatesResponse
> = {
  id: 'sportmonks_football_get_states',
  name: 'Get States',
  description:
    'Retrieve all fixture states (e.g. Not Started, 1st Half, Full Time) from Sportmonks',
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
    url: (params) => appendSportmonksQuery(`${SPORTMONKS_FOOTBALL_BASE_URL}/states`, params),
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_states')
    }
    return {
      success: true,
      output: {
        states: Array.isArray(data.data) ? data.data : [],
        pagination: data.pagination ?? null,
      },
    }
  },

  outputs: {
    states: {
      type: 'array',
      description: 'Array of fixture state objects',
      items: { type: 'object', properties: SPORTMONKS_STATE_PROPERTIES },
    },
    pagination: SPORTMONKS_PAGINATION_OUTPUT,
  },
}
