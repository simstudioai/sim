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

export interface SportmonksMsGetDriversBySeasonParams
  extends SportmonksBaseParams,
    SportmonksPaginationParams {
  seasonId: string
}

export interface SportmonksMsGetDriversBySeasonResponse extends ToolResponse {
  output: {
    drivers: SportmonksMsDriver[]
    pagination?: SportmonksPagination | null
  }
}

export const sportmonksMotorsportGetDriversBySeasonTool: ToolConfig<
  SportmonksMsGetDriversBySeasonParams,
  SportmonksMsGetDriversBySeasonResponse
> = {
  id: 'sportmonks_motorsport_get_drivers_by_season',
  name: 'Get Drivers by Season',
  description: 'Retrieve all motorsport drivers for a season by season ID from Sportmonks',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Sportmonks API token',
    },
    seasonId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The unique id of the season',
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
    url: (params) => {
      const url = `${SPORTMONKS_MOTORSPORT_BASE_URL}/drivers/seasons/${encodeURIComponent(params.seasonId.trim())}`
      return appendSportmonksQuery(url, params)
    },
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_drivers_by_season')
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
      description: 'Array of driver objects for the season',
      items: { type: 'object', properties: SPORTMONKS_MS_DRIVER_PROPERTIES },
    },
    pagination: SPORTMONKS_PAGINATION_OUTPUT,
  },
}
