import type { GrainDeleteHookV2Params, GrainDeleteHookV2Response } from '@/tools/grain/types'
import type { ToolConfig } from '@/tools/types'

export const grainDeleteHookV2Tool: ToolConfig<GrainDeleteHookV2Params, GrainDeleteHookV2Response> =
  {
    id: 'grain_delete_hook_v2',
    name: 'Grain Delete Webhook',
    description: 'Delete a webhook by ID (v2 API)',
    version: '2.0.0',

    params: {
      apiKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Grain API key (Personal or Workspace Access Token)',
      },
      hookId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'The hook UUID to delete (e.g., "a1b2c3d4-e5f6-7890-abcd-ef1234567890")',
      },
    },

    request: {
      url: (params) => `https://api.grain.com/_/public-api/v2/hooks/${params.hookId.trim()}`,
      method: 'DELETE',
      headers: (params) => ({
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.apiKey}`,
        'Public-Api-Version': '2025-10-31',
      }),
    },

    transformResponse: async (response) => {
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
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
