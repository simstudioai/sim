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
    hookType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Type of webhook: "recording_added" or "upload_status"',
    },
    filterBeforeDatetime: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter: recordings before this ISO8601 date (e.g., "2024-01-15T00:00:00Z")',
    },
    filterAfterDatetime: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter: recordings after this ISO8601 date (e.g., "2024-01-01T00:00:00Z")',
    },
    filterParticipantScope: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter: "internal" or "external"',
    },
    filterTeamId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter: specific team UUID (e.g., "a1b2c3d4-e5f6-7890-abcd-ef1234567890")',
    },
    filterMeetingTypeId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Filter: specific meeting type UUID (e.g., "a1b2c3d4-e5f6-7890-abcd-ef1234567890")',
    },
    includeHighlights: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Include highlights in webhook payload',
    },
    includeParticipants: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Include participants in webhook payload',
    },
    includeAiSummary: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Include AI summary in webhook payload',
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
      const body: Record<string, any> = {
        hook_url: params.hookUrl,
        hook_type: params.hookType,
      }

      const filter: Record<string, any> = {}
      if (params.filterBeforeDatetime) {
        filter.before_datetime = params.filterBeforeDatetime
      }
      if (params.filterAfterDatetime) {
        filter.after_datetime = params.filterAfterDatetime
      }
      if (params.filterParticipantScope) {
        filter.participant_scope = params.filterParticipantScope
      }
      if (params.filterTeamId) {
        filter.team = params.filterTeamId
      }
      if (params.filterMeetingTypeId) {
        filter.meeting_type = params.filterMeetingTypeId
      }
      if (Object.keys(filter).length > 0) {
        body.filter = filter
      }

      const include: Record<string, any> = {}
      if (params.includeHighlights) {
        include.highlights = true
      }
      if (params.includeParticipants) {
        include.participants = true
      }
      if (params.includeAiSummary) {
        include.ai_summary = true
      }
      if (Object.keys(include).length > 0) {
        body.include = include
      }

      return body
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || data.message || 'Failed to create webhook')
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
      description: 'Type of hook: recording_added or upload_status',
    },
    filter: {
      type: 'object',
      description: 'Applied filters',
    },
    include: {
      type: 'object',
      description: 'Included fields',
    },
    inserted_at: {
      type: 'string',
      description: 'ISO8601 creation timestamp',
    },
  },
}
