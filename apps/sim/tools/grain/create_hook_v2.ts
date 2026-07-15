import type { GrainCreateHookV2Params, GrainCreateHookV2Response } from '@/tools/grain/types'
import type { ToolConfig } from '@/tools/types'

export const grainCreateHookV2Tool: ToolConfig<GrainCreateHookV2Params, GrainCreateHookV2Response> =
  {
    id: 'grain_create_hook_v2',
    name: 'Grain Create Webhook',
    description: 'Create a webhook for a specific Grain event type (v2 API)',
    version: '2.0.0',

    params: {
      apiKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Grain API key (Personal or Workspace Access Token)',
      },
      hookUrl: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description:
          'Webhook endpoint URL. Grain performs a reachability test on creation — the endpoint must respond 2xx.',
      },
      hookType: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description:
          'Event type the hook subscribes to. One of: recording_added, recording_updated, recording_deleted, highlight_added, highlight_updated, highlight_deleted, story_added, story_updated, story_deleted, upload_status',
      },
      include: {
        type: 'json',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Optional include object controlling payload richness. For recording hooks: {"participants": true, "highlights": true, "ai_summary": true}. For highlight hooks: {"transcript": true, "speakers": true}.',
      },
    },

    request: {
      url: 'https://api.grain.com/_/public-api/v2/hooks/create',
      method: 'POST',
      headers: (params) => ({
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.apiKey}`,
        'Public-Api-Version': '2025-10-31',
      }),
      body: (params) => {
        const body: Record<string, unknown> = {
          hook_url: params.hookUrl,
          hook_type: params.hookType,
        }
        if (params.include && Object.keys(params.include).length > 0) {
          body.include = params.include
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
      hook_type: {
        type: 'string',
        description: 'Event type the hook subscribes to',
      },
      include: {
        type: 'json',
        description: 'Include object the hook was created with',
      },
      inserted_at: {
        type: 'string',
        description: 'ISO8601 creation timestamp',
      },
    },
  }
