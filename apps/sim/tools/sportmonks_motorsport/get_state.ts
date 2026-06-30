import {
  appendSportmonksQuery,
  buildSportmonksHeaders,
  handleSportmonksError,
  type SportmonksBaseParams,
} from '@/tools/sportmonks/types'
import {
  SPORTMONKS_MOTORSPORT_BASE_URL,
  SPORTMONKS_MS_STATE_PROPERTIES,
  type SportmonksMsState,
} from '@/tools/sportmonks_motorsport/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface SportmonksMsGetStateParams extends SportmonksBaseParams {
  stateId: string
}

export interface SportmonksMsGetStateResponse extends ToolResponse {
  output: {
    state: SportmonksMsState | null
  }
}

export const sportmonksMotorsportGetStateTool: ToolConfig<
  SportmonksMsGetStateParams,
  SportmonksMsGetStateResponse
> = {
  id: 'sportmonks_motorsport_get_state',
  name: 'Get State by ID',
  description: 'Retrieve a single motorsport fixture state by its ID from Sportmonks',
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
    include: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Semicolon-separated relations to enrich the response',
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
      const url = `${SPORTMONKS_MOTORSPORT_BASE_URL}/states/${encodeURIComponent(params.stateId.trim())}`
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
      properties: SPORTMONKS_MS_STATE_PROPERTIES,
    },
  },
}
