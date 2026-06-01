import type { ListModelsParams, ListModelsResponse } from '@/tools/cursor/types'
import type { ToolConfig } from '@/tools/types'

const listModelsBase = {
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Cursor API key',
    },
  },
  request: {
    url: () => 'https://api.cursor.com/v0/models',
    method: 'GET',
    headers: (params: ListModelsParams) => ({
      Authorization: `Basic ${Buffer.from(`${params.apiKey}:`).toString('base64')}`,
    }),
  },
} satisfies Pick<ToolConfig<ListModelsParams, any>, 'params' | 'request'>

export const listModelsTool: ToolConfig<ListModelsParams, ListModelsResponse> = {
  id: 'cursor_list_models',
  name: 'Cursor List Models',
  description: 'List the models available for launching cloud agents.',
  version: '1.0.0',

  ...listModelsBase,

  transformResponse: async (response) => {
    const data = await response.json()
    const models = data.models ?? []

    return {
      success: true,
      output: {
        content: `Found ${models.length} model(s)`,
        metadata: {
          models,
        },
      },
    }
  },

  outputs: {
    content: { type: 'string', description: 'Human-readable model count' },
    metadata: {
      type: 'object',
      description: 'Models metadata',
      properties: {
        models: {
          type: 'array',
          description: 'Array of available model names',
          items: { type: 'string', description: 'Model name' },
        },
      },
    },
  },
}

interface ListModelsV2Response {
  success: boolean
  output: {
    models: string[]
  }
}

export const listModelsV2Tool: ToolConfig<ListModelsParams, ListModelsV2Response> = {
  ...listModelsBase,
  id: 'cursor_list_models_v2',
  name: 'Cursor List Models',
  description:
    'List the models available for launching cloud agents. Returns API-aligned fields only.',
  version: '2.0.0',
  transformResponse: async (response) => {
    const data = await response.json()

    return {
      success: true,
      output: {
        models: Array.isArray(data.models) ? data.models : [],
      },
    }
  },
  outputs: {
    models: {
      type: 'array',
      description: 'Array of available model names',
      items: { type: 'string', description: 'Model name' },
    },
  },
}
