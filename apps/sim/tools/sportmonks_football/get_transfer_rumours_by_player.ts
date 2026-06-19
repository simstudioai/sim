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

export interface SportmonksGetTransferRumoursByPlayerParams
  extends SportmonksBaseParams,
    SportmonksPaginationParams {
  playerId: string
}

export interface SportmonksGetTransferRumoursByPlayerResponse extends ToolResponse {
  output: {
    transferRumours: SportmonksTransferRumour[]
    pagination?: SportmonksPagination | null
  }
}

export const sportmonksGetTransferRumoursByPlayerTool: ToolConfig<
  SportmonksGetTransferRumoursByPlayerParams,
  SportmonksGetTransferRumoursByPlayerResponse
> = {
  id: 'sportmonks_football_get_transfer_rumours_by_player',
  name: 'Get Transfer Rumours by Player',
  description: 'Retrieve transfer rumours for a player ID from Sportmonks',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Sportmonks API token',
    },
    playerId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The unique id of the player',
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
      const url = `${SPORTMONKS_FOOTBALL_BASE_URL}/transfer-rumours/players/${encodeURIComponent(params.playerId.trim())}`
      return appendSportmonksQuery(url, params)
    },
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_transfer_rumours_by_player')
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
      description: 'Array of transfer rumour objects for the player',
      items: { type: 'object', properties: SPORTMONKS_TRANSFER_RUMOUR_PROPERTIES },
    },
    pagination: SPORTMONKS_PAGINATION_OUTPUT,
  },
}
