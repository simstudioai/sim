import {
  appendSportmonksQuery,
  buildSportmonksHeaders,
  handleSportmonksError,
  type SportmonksBaseParams,
} from '@/tools/sportmonks/types'
import {
  SPORTMONKS_FOOTBALL_BASE_URL,
  SPORTMONKS_TRANSFER_PROPERTIES,
  type SportmonksTransfer,
} from '@/tools/sportmonks_football/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface SportmonksGetTransferParams extends SportmonksBaseParams {
  transferId: string
}

export interface SportmonksGetTransferResponse extends ToolResponse {
  output: {
    transfer: SportmonksTransfer | null
  }
}

export const sportmonksGetTransferTool: ToolConfig<
  SportmonksGetTransferParams,
  SportmonksGetTransferResponse
> = {
  id: 'sportmonks_football_get_transfer',
  name: 'Get Transfer by ID',
  description: 'Retrieve a single transfer by its ID from Sportmonks',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Sportmonks API token',
    },
    transferId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The unique id of the transfer',
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
      const url = `${SPORTMONKS_FOOTBALL_BASE_URL}/transfers/${encodeURIComponent(params.transferId.trim())}`
      return appendSportmonksQuery(url, params)
    },
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_transfer')
    }
    return {
      success: true,
      output: {
        transfer: data.data ?? null,
      },
    }
  },

  outputs: {
    transfer: {
      type: 'object',
      description: 'The requested transfer object',
      properties: SPORTMONKS_TRANSFER_PROPERTIES,
    },
  },
}
