import type { GrainCreateHookParams, GrainCreateHookResponse } from '@/tools/grain/types'
import type { ToolConfig } from '@/tools/types'

export const grainCreateHookTool: ToolConfig<GrainCreateHookParams, GrainCreateHookResponse> = {
  id: 'grain_create_hook',
  name: 'Grain Create Webhook',
  description: 'Create a webhook to receive recording events',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Grain API key (Personal Access Token)',
    },
    hookUrl: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Webhook endpoint URL (e.g., "https://example.com/webhooks/grain")',
    },
    viewId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Grain view ID from GET /_/public-api/views',
    },
    actions: {
      type: 'array',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional list of actions to subscribe to: added, updated, removed',
      items: {
        type: 'string',
      },
    },
  },

  request: {
    url: 'https://api.grain.com/_/public-api/hooks',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
    body: (params) => {
      const body: Record<string, any> = {
        version: 2,
        hook_url: params.hookUrl,
        view_id: params.viewId,
      }
      if (params.actions && params.actions.length > 0) {
        body.actions = params.actions
      }

      return body
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || data.message || 'Failed to create webhook')
    }

    if (!data?.id) {
      throw new Error('Grain webhook created but response did not include a webhook id')
    }

    return {
      success: true,
      output: data,
    }
  },

  outputs: {
    id: {
      type: 'string',
      description: 'Hook UUID',
    },
    enabled: {
      type: 'boolean',
      description: 'Whether hook is active',
    },
    hook_url: {
      type: 'string',
      description: 'The webhook URL',
    },
    view_id: {
      type: 'string',
      description: 'Grain view ID for the webhook',
    },
    actions: {
      type: 'array',
      description: 'Configured actions for the webhook',
    },
    inserted_at: {
      type: 'string',
      description: 'ISO8601 creation timestamp',
    },
  },
}
