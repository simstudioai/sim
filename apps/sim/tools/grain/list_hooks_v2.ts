import type { GrainListHooksV2Params, GrainListHooksV2Response } from '@/tools/grain/types'
import type { ToolConfig } from '@/tools/types'

export const grainListHooksV2Tool: ToolConfig<GrainListHooksV2Params, GrainListHooksV2Response> = {
  id: 'grain_list_hooks_v2',
  name: 'Grain List Webhooks',
  description: 'List webhooks for the account (v2 API)',
  version: '2.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Grain API key (Personal or Workspace Access Token)',
    },
    hookType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Only return hooks with this event type. One of: recording_added, recording_updated, recording_deleted, highlight_added, highlight_updated, highlight_deleted, story_added, story_updated, story_deleted, upload_status',
    },
    state: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only return hooks that are "enabled" or "disabled"',
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
    body: (params) => {
      const filter: Record<string, unknown> = {}
      if (params.hookType) {
        filter.hook_type = params.hookType
      }
      if (params.state) {
        filter.state = params.state
      }
      return Object.keys(filter).length > 0 ? { filter } : {}
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || data.message || 'Failed to list webhooks')
    }

    return {
      success: true,
      output: {
        hooks: data.hooks || [],
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
          hook_type: { type: 'string', description: 'Event type the hook subscribes to' },
          include: { type: 'object', description: 'Include object the hook was created with' },
          inserted_at: { type: 'string', description: 'Creation timestamp' },
        },
      },
    },
  },
}
