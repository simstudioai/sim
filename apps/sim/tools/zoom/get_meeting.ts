import type { ToolConfig } from '@/tools/types'
import type { ZoomGetMeetingParams, ZoomGetMeetingResponse } from '@/tools/zoom/types'
import { MEETING_OUTPUT_PROPERTIES } from '@/tools/zoom/types'

export const zoomGetMeetingTool: ToolConfig<ZoomGetMeetingParams, ZoomGetMeetingResponse> = {
  id: 'zoom_get_meeting',
  name: 'Zoom Get Meeting',
  description: 'Get details of a specific Zoom meeting',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'zoom',
    requiredScopes: ['meeting:read:meeting'],
  },

  params: {
    meetingId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The meeting ID (e.g., "1234567890" or "85746065432")',
    },
    occurrenceId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Occurrence ID for recurring meetings',
    },
    showPreviousOccurrences: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Show previous occurrences for recurring meetings',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = `https://api.zoom.us/v2/meetings/${encodeURIComponent(params.meetingId)}`
      const queryParams = new URLSearchParams()

      if (params.occurrenceId) {
        queryParams.append('occurrence_id', params.occurrenceId)
      }
      if (params.showPreviousOccurrences != null) {
        queryParams.append('show_previous_occurrences', String(params.showPreviousOccurrences))
      }

      const queryString = queryParams.toString()
      return queryString ? `${baseUrl}?${queryString}` : baseUrl
    },
    method: 'GET',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Missing access token for Zoom API request')
      }
      return {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.accessToken}`,
      }
    },
  },

  transformResponse: async (response) => {
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      return {
        success: false,
        error: errorData.message || `Zoom API error: ${response.status} ${response.statusText}`,
        output: { meeting: {} as any },
      }
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        meeting: {
          id: data.id,
          uuid: data.uuid,
          host_id: data.host_id,
          host_email: data.host_email,
          topic: data.topic,
          type: data.type,
          status: data.status,
          start_time: data.start_time,
          duration: data.duration,
          timezone: data.timezone,
          agenda: data.agenda,
          created_at: data.created_at,
          start_url: data.start_url,
          join_url: data.join_url,
          password: data.password,
          h323_password: data.h323_password,
          pstn_password: data.pstn_password,
          encrypted_password: data.encrypted_password,
          settings: data.settings,
          recurrence: data.recurrence,
          occurrences: data.occurrences,
        },
      },
    }
  },

  outputs: {
    meeting: {
      type: 'object',
      description: 'The meeting details',
      properties: MEETING_OUTPUT_PROPERTIES,
    },
  },
}
