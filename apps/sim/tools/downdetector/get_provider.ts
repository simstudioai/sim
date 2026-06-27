import {
  DOWNDETECTOR_API_BASE,
  type DowndetectorGetProviderParams,
  type DowndetectorGetProviderResponse,
} from '@/tools/downdetector/types'
import {
  downdetectorHeaders,
  encodePathParam,
  extractDowndetectorError,
} from '@/tools/downdetector/utils'
import type { ToolConfig } from '@/tools/types'

interface RawProvider {
  id?: number
  name?: string
  downdetector_id?: number
}

export const getProviderTool: ToolConfig<
  DowndetectorGetProviderParams,
  DowndetectorGetProviderResponse
> = {
  id: 'downdetector_get_provider',
  name: 'Downdetector Get Provider',
  description:
    'Get details for a Downdetector provider (ISP or network operator) by id, such as its name and Downdetector id.',
  version: '1.0.0',

  params: {
    providerId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The Downdetector provider id',
    },
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Downdetector API Bearer token',
    },
  },

  request: {
    url: (params) =>
      `${DOWNDETECTOR_API_BASE}/providers/${encodePathParam(params.providerId, 'Provider ID')}`,
    method: 'GET',
    headers: (params) => downdetectorHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    const data: RawProvider = await response.json()
    if (!response.ok) {
      throw new Error(extractDowndetectorError(data, 'Failed to get provider'))
    }

    return {
      success: true,
      output: {
        provider: {
          id: data.id ?? null,
          name: data.name ?? null,
          downdetectorId: data.downdetector_id ?? null,
        },
      },
    }
  },

  outputs: {
    provider: {
      type: 'object',
      description: 'Provider details',
      properties: {
        id: { type: 'number', description: 'Provider id' },
        name: { type: 'string', description: 'Provider name' },
        downdetectorId: { type: 'number', description: 'Downdetector internal provider id' },
      },
    },
  },
}
