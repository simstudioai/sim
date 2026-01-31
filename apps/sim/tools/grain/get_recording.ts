import type { GrainGetRecordingParams, GrainGetRecordingResponse } from '@/tools/grain/types'
import type { ToolConfig } from '@/tools/types'

export const grainGetRecordingTool: ToolConfig<GrainGetRecordingParams, GrainGetRecordingResponse> =
  {
    id: 'grain_get_recording',
    name: 'Grain Get Recording',
    description: 'Get details of a single recording by ID',
    version: '1.0.0',

    params: {
      apiKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Grain API key (Personal Access Token)',
      },
      recordingId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'The recording UUID (e.g., "a1b2c3d4-e5f6-7890-abcd-ef1234567890")',
      },
      includeHighlights: {
        type: 'boolean',
        required: false,
        visibility: 'user-only',
        description: 'Include highlights/clips',
      },
      includeParticipants: {
        type: 'boolean',
        required: false,
        visibility: 'user-only',
        description: 'Include participant list',
      },
      includeAiSummary: {
        type: 'boolean',
        required: false,
        visibility: 'user-only',
        description: 'Include AI summary',
      },
      includeCalendarEvent: {
        type: 'boolean',
        required: false,
        visibility: 'user-only',
        description: 'Include calendar event data',
      },
      includeHubspot: {
        type: 'boolean',
        required: false,
        visibility: 'user-only',
        description: 'Include HubSpot associations',
      },
    },

    request: {
      url: (params) => `https://api.grain.com/_/public-api/v2/recordings/${params.recordingId}`,
      method: 'POST',
      headers: (params) => ({
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.apiKey}`,
        'Public-Api-Version': '2025-10-31',
      }),
      body: (params) => {
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
        if (params.includeCalendarEvent) {
          include.calendar_event = true
        }
        if (params.includeHubspot) {
          include.hubspot = true
        }

        if (Object.keys(include).length > 0) {
          return { include }
        }
        return {}
      },
    },

    transformResponse: async (response) => {
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || data.message || 'Failed to get recording')
      }

      return {
        success: true,
        output: data,
      }
    },

    outputs: {
      id: {
        type: 'string',
        description: 'Recording UUID',
      },
      title: {
        type: 'string',
        description: 'Recording title',
      },
      start_datetime: {
        type: 'string',
        description: 'ISO8601 start timestamp',
      },
      end_datetime: {
        type: 'string',
        description: 'ISO8601 end timestamp',
      },
      duration_ms: {
        type: 'number',
        description: 'Duration in milliseconds',
      },
      media_type: {
        type: 'string',
        description: 'audio, transcript, or video',
      },
      source: {
        type: 'string',
        description: 'Recording source (zoom, meet, teams, etc.)',
      },
      url: {
        type: 'string',
        description: 'URL to view in Grain',
      },
      thumbnail_url: {
        type: 'string',
        description: 'Thumbnail image URL',
        optional: true,
      },
      tags: {
        type: 'array',
        description: 'Array of tag strings',
      },
      teams: {
        type: 'array',
        description: 'Teams the recording belongs to',
      },
      meeting_type: {
        type: 'object',
        description: 'Meeting type info (id, name, scope)',
        optional: true,
      },
      highlights: {
        type: 'array',
        description: 'Highlights (if included)',
        optional: true,
      },
      participants: {
        type: 'array',
        description: 'Participants (if included)',
        optional: true,
      },
      ai_summary: {
        type: 'object',
        description: 'AI summary text (if included)',
        optional: true,
      },
      calendar_event: {
        type: 'object',
        description: 'Calendar event data (if included)',
        optional: true,
      },
      hubspot: {
        type: 'object',
        description: 'HubSpot associations (if included)',
        optional: true,
      },
    },
  }
