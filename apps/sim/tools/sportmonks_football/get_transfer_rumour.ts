import {
  appendSportmonksQuery,
  buildSportmonksHeaders,
  handleSportmonksError,
  type SportmonksBaseParams,
} from '@/tools/sportmonks/types'
import {
  SPORTMONKS_FOOTBALL_BASE_URL,
  SPORTMONKS_TRANSFER_RUMOUR_PROPERTIES,
  type SportmonksTransferRumour,
} from '@/tools/sportmonks_football/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface SportmonksGetTransferRumourParams extends SportmonksBaseParams {
  rumourId: string
}

export interface SportmonksGetTransferRumourResponse extends ToolResponse {
  output: {
    transferRumour: SportmonksTransferRumour | null
  }
}

export const sportmonksGetTransferRumourTool: ToolConfig<
  SportmonksGetTransferRumourParams,
  SportmonksGetTransferRumourResponse
> = {
  id: 'sportmonks_football_get_transfer_rumour',
  name: 'Get Transfer Rumour by ID',
  description: 'Retrieve a single transfer rumour by its ID from Sportmonks',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Sportmonks API token',
    },
    rumourId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The unique id of the transfer rumour',
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
  },

  request: {
    url: (params) => {
      const url = `${SPORTMONKS_FOOTBALL_BASE_URL}/transfer-rumours/${encodeURIComponent(params.rumourId.trim())}`
      return appendSportmonksQuery(url, params)
    },
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_transfer_rumour')
    }
    return {
      success: true,
      output: {
        transferRumour: data.data ?? null,
      },
    }
  },

  outputs: {
    transferRumour: {
      type: 'object',
      description: 'The requested transfer rumour object',
      properties: SPORTMONKS_TRANSFER_RUMOUR_PROPERTIES,
    },
  },
}
