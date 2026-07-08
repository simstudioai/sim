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
  SPORTMONKS_TRANSFER_RUMOUR_PROPERTIES,
  type SportmonksTransferRumour,
} from '@/tools/sportmonks_football/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface SportmonksGetTransferRumoursBetweenDatesParams
  extends SportmonksBaseParams,
    SportmonksPaginationParams {
  startDate: string
  endDate: string
}

export interface SportmonksGetTransferRumoursBetweenDatesResponse extends ToolResponse {
  output: {
    transferRumours: SportmonksTransferRumour[]
    pagination?: SportmonksPagination | null
  }
}

export const sportmonksGetTransferRumoursBetweenDatesTool: ToolConfig<
  SportmonksGetTransferRumoursBetweenDatesParams,
  SportmonksGetTransferRumoursBetweenDatesResponse
> = {
  id: 'sportmonks_football_get_transfer_rumours_between_dates',
  name: 'Get Transfer Rumours Between Dates',
  description: 'Retrieve transfer rumours within a date range (YYYY-MM-DD) from Sportmonks',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Sportmonks API token',
    },
    startDate: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Start date in YYYY-MM-DD format',
    },
    endDate: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'End date in YYYY-MM-DD format',
    },
    include: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Semicolon-separated relations to enrich the response (e.g. player;fromTeam;toTeam)',
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
      const url = `${SPORTMONKS_FOOTBALL_BASE_URL}/transfer-rumours/between/${encodeURIComponent(
        params.startDate.trim()
      )}/${encodeURIComponent(params.endDate.trim())}`
      return appendSportmonksQuery(url, params)
    },
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_transfer_rumours_between_dates')
    }
    return {
      success: true,
      output: {
        transferRumours: Array.isArray(data.data) ? data.data : [],
        pagination: data.pagination ?? null,
      },
    }
  },

  outputs: {
    transferRumours: {
      type: 'array',
      description: 'Array of transfer rumour objects within the date range',
      items: { type: 'object', properties: SPORTMONKS_TRANSFER_RUMOUR_PROPERTIES },
    },
    pagination: SPORTMONKS_PAGINATION_OUTPUT,
  },
}
