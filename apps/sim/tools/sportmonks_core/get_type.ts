import {
  buildSportmonksHeaders,
  handleSportmonksError,
  type SportmonksBaseParams,
} from '@/tools/sportmonks/types'
import {
  SPORTMONKS_CORE_BASE_URL,
  SPORTMONKS_TYPE_PROPERTIES,
  type SportmonksType,
} from '@/tools/sportmonks_core/types'
import type { ToolConfig, ToolResponse } from '@/tools/types'

export interface SportmonksGetTypeParams extends SportmonksBaseParams {
  typeId: string
}

export interface SportmonksGetTypeResponse extends ToolResponse {
  output: {
    type: SportmonksType | null
  }
}

export const sportmonksCoreGetTypeTool: ToolConfig<
  SportmonksGetTypeParams,
  SportmonksGetTypeResponse
> = {
  id: 'sportmonks_core_get_type',
  name: 'Get Type by ID',
  description: 'Retrieve a single type by its ID from the Sportmonks Core API',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Sportmonks API token',
    },
    typeId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The unique id of the type',
    },
  },

  request: {
    url: (params) =>
      `${SPORTMONKS_CORE_BASE_URL}/types/${encodeURIComponent(params.typeId.trim())}`,
    method: 'GET',
    headers: (params) => buildSportmonksHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    if (!response.ok) {
      handleSportmonksError(data, response.status, 'get_type')
    }
    return {
      success: true,
      output: {
        type: data.data ?? null,
      },
    }
  },

  outputs: {
    type: {
      type: 'object',
      description: 'The requested type object',
      properties: SPORTMONKS_TYPE_PROPERTIES,
    },
  },
}
