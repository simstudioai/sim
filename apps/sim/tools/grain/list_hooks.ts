import type { GrainListHooksParams, GrainListHooksResponse } from '@/tools/grain/types'
import type { ToolConfig } from '@/tools/types'

export const grainListHooksTool: ToolConfig<GrainListHooksParams, GrainListHooksResponse> = {
  id: 'grain_list_hooks',
  name: 'Grain List Webhooks',
  description: 'List all webhooks for the account',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Grain API key (Personal Access Token)',
    },
  },

  request: {
    url: 'https://api.grain.com/_/public-api/v2/hooks',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
      'Public-Api-Version': '2025-10-31',
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || data.message || 'Failed to list webhooks')
    }

    return {
      success: true,
      output: {
        hooks: data.hooks || data || [],
      },
    }
  },

  outputs: {
    hooks: {
      type: 'array',
      description: 'Array of hook objects',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Hook UUID' },
          enabled: { type: 'boolean', description: 'Whether hook is active' },
          hook_url: { type: 'string', description: 'Webhook URL' },
          hook_type: { type: 'string', description: 'Type: recording_added or upload_status' },
          filter: { type: 'object', description: 'Applied filters' },
          include: { type: 'object', description: 'Included fields' },
          inserted_at: { type: 'string', description: 'Creation timestamp' },
        },
      },
    },
  },
}
