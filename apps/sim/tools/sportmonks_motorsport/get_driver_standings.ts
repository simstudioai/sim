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
  SPORTMONKS_MS_STANDING_PROPERTIES,
  type SportmonksMsStanding,
} from '@/tools/sportmonks_motorsport/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface SportmonksMsGetDriverStandingsParams
  extends SportmonksBaseParams,
    SportmonksPaginationParams {}

export interface SportmonksMsGetDriverStandingsResponse extends ToolResponse {
  output: {
    standings: SportmonksMsStanding[]
    pagination?: SportmonksPagination | null
  }
}

export const sportmonksMotorsportGetDriverStandingsTool: ToolConfig<
  SportmonksMsGetDriverStandingsParams,
  SportmonksMsGetDriverStandingsResponse
> = {
  id: 'sportmonks_motorsport_get_driver_standings',
  name: 'Get All Driver Standings',
  description: 'Retrieve all driver championship standings from Sportmonks',
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
      description: 'Semicolon-separated relations to enrich the response (e.g. participant;season)',
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
      appendSportmonksQuery(`${SPORTMONKS_MOTORSPORT_BASE_URL}/standings/drivers`, params),
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_driver_standings')
    }
    return {
      success: true,
      output: {
        standings: Array.isArray(data.data) ? data.data : [],
        pagination: data.pagination ?? null,
      },
    }
  },

  outputs: {
    standings: {
      type: 'array',
      description: 'Array of driver standing entries',
      items: { type: 'object', properties: SPORTMONKS_MS_STANDING_PROPERTIES },
    },
    pagination: SPORTMONKS_PAGINATION_OUTPUT,
  },
}
