import type { GrainDeleteHookParams, GrainDeleteHookResponse } from '@/tools/grain/types'
import type { ToolConfig } from '@/tools/types'

export const grainDeleteHookTool: ToolConfig<GrainDeleteHookParams, GrainDeleteHookResponse> = {
  id: 'grain_delete_hook',
  name: 'Grain Delete Webhook',
  description: 'Delete a webhook by ID',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'grain',
  },

  params: {
    accessToken: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'OAuth access token (auto-injected)',
    },
    hookId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The hook UUID to delete',
    },
  },

  request: {
    url: (params) => `https://api.grain.com/_/public-api/v2/hooks/${params.hookId}`,
    method: 'DELETE',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Missing access token for Grain API request')
      }
      return {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.accessToken}`,
        'Public-Api-Version': '2025-10-31',
      }
    },
  },

  transformResponse: async (response) => {
    if (!response.ok) {
      const data = await response.json()
      throw new Error(data.error || data.message || 'Failed to delete webhook')
    }

    return {
      success: true,
      output: {
        success: true,
      },
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'True when webhook was successfully deleted',
    },
  },
}
