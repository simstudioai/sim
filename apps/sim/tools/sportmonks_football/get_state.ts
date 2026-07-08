import {
  appendSportmonksQuery,
  buildSportmonksHeaders,
  handleSportmonksError,
  type SportmonksBaseParams,
} from '@/tools/sportmonks/types'
import {
  SPORTMONKS_FOOTBALL_BASE_URL,
  SPORTMONKS_STATE_PROPERTIES,
  type SportmonksState,
} from '@/tools/sportmonks_football/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface SportmonksGetStateParams extends SportmonksBaseParams {
  stateId: string
}

export interface SportmonksGetStateResponse extends ToolResponse {
  output: {
    state: SportmonksState | null
  }
}

export const sportmonksGetStateTool: ToolConfig<
  SportmonksGetStateParams,
  SportmonksGetStateResponse
> = {
  id: 'sportmonks_football_get_state',
  name: 'Get State by ID',
  description: 'Retrieve a single fixture state by its ID from Sportmonks',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Sportmonks API token',
    },
    stateId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The unique id of the state',
    },
  },

  request: {
    url: (params) => {
      const url = `${SPORTMONKS_FOOTBALL_BASE_URL}/states/${encodeURIComponent(params.stateId.trim())}`
      return appendSportmonksQuery(url, params)
    },
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_state')
    }
    return {
      success: true,
      output: {
        state: data.data ?? null,
      },
    }
  },

  outputs: {
    state: {
      type: 'object',
      description: 'The requested fixture state object',
      properties: SPORTMONKS_STATE_PROPERTIES,
    },
  },
}
