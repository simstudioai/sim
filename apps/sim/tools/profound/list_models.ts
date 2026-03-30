import type { ToolConfig } from '@/tools/types'
import type { ProfoundListModelsParams, ProfoundListModelsResponse } from './types'

export const profoundListModelsTool: ToolConfig<
  ProfoundListModelsParams,
  ProfoundListModelsResponse
> = {
  id: 'profound_list_models',
  name: 'Profound List Models',
  description: 'List all AI models/platforms tracked in Profound',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Profound API Key',
    },
  },

  request: {
    url: 'https://api.tryprofound.com/v1/org/models',
    method: 'GET',
    headers: (params) => ({
      'X-API-Key': params.apiKey,
      Accept: 'application/json',
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    if (!response.ok) {
      throw new Error(data.detail?.[0]?.msg || 'Failed to list models')
    }
    return {
      success: true,
      output: {
        models: (data ?? []).map((item: { id: string; name: string }) => ({
          id: item.id ?? null,
          name: item.name ?? null,
        })),
      },
    }
  },

  outputs: {
    models: {
      type: 'json',
      description: 'List of AI models/platforms',
      properties: {
        id: { type: 'string', description: 'Model ID (UUID)' },
        name: { type: 'string', description: 'Model/platform name' },
      },
    },
  },
}
