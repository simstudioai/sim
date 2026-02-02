import type { GrainListRecordingsParams, GrainListRecordingsResponse } from '@/tools/grain/types'
import type { ToolConfig } from '@/tools/types'

export const grainListRecordingsTool: ToolConfig<
  GrainListRecordingsParams,
  GrainListRecordingsResponse
> = {
  id: 'grain_list_recordings',
  name: 'Grain List Recordings',
  description: 'List recordings from Grain with optional filters and pagination',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Grain API key (Personal Access Token)',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor for next page (returned from previous response)',
    },
    beforeDatetime: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only recordings before this ISO8601 timestamp (e.g., "2024-01-15T00:00:00Z")',
    },
    afterDatetime: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Only recordings after this ISO8601 timestamp (e.g., "2024-01-01T00:00:00Z")',
    },
    participantScope: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter: "internal" or "external"',
    },
    titleSearch: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search term to filter by recording title (e.g., "weekly standup")',
    },
    teamId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by team UUID (e.g., "a1b2c3d4-e5f6-7890-abcd-ef1234567890")',
    },
    meetingTypeId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by meeting type UUID (e.g., "a1b2c3d4-e5f6-7890-abcd-ef1234567890")',
    },
    includeHighlights: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Include highlights/clips in response',
    },
    includeParticipants: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Include participant list in response',
    },
    includeAiSummary: {
      type: 'boolean',
      required: false,
      visibility: 'user-only',
      description: 'Include AI-generated summary',
    },
  },

  request: {
    url: 'https://api.grain.com/_/public-api/v2/recordings',
    method: 'POST',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
      'Public-Api-Version': '2025-10-31',
    }),
    body: (params) => {
      const body: Record<string, any> = {}

      if (params.cursor) {
        body.cursor = params.cursor
      }

      const filter: Record<string, any> = {}
      if (params.beforeDatetime) {
        filter.before_datetime = params.beforeDatetime
      }
      if (params.afterDatetime) {
        filter.after_datetime = params.afterDatetime
      }
      if (params.participantScope) {
        filter.participant_scope = params.participantScope
      }
      if (params.titleSearch) {
        filter.title_search = params.titleSearch
      }
      if (params.teamId) {
        filter.team = params.teamId
      }
      if (params.meetingTypeId) {
        filter.meeting_type = params.meetingTypeId
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
      throw new Error(data.error || data.message || 'Failed to list recordings')
    }

    return {
      success: true,
      output: {
        recordings: data.recordings || [],
        cursor: data.cursor || null,
      },
    }
  },

  outputs: {
    recordings: {
      type: 'array',
      description: 'Array of recording objects',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Recording UUID' },
          title: { type: 'string', description: 'Recording title' },
          start_datetime: { type: 'string', description: 'ISO8601 start timestamp' },
          end_datetime: { type: 'string', description: 'ISO8601 end timestamp' },
          duration_ms: { type: 'number', description: 'Duration in milliseconds' },
          media_type: { type: 'string', description: 'audio, transcript, or video' },
          source: { type: 'string', description: 'Recording source' },
          url: { type: 'string', description: 'URL to view in Grain' },
          thumbnail_url: { type: 'string', description: 'Thumbnail URL' },
          tags: { type: 'array', description: 'Array of tags' },
          teams: { type: 'array', description: 'Teams the recording belongs to' },
          meeting_type: { type: 'object', description: 'Meeting type info' },
        },
      },
    },
    cursor: {
      type: 'string',
      description: 'Cursor for next page (null if no more)',
      optional: true,
    },
  },
}
