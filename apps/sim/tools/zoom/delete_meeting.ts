import type { ToolConfig } from '@/tools/types'
import type { ZoomDeleteMeetingParams, ZoomDeleteMeetingResponse } from '@/tools/zoom/types'

export const zoomDeleteMeetingTool: ToolConfig<ZoomDeleteMeetingParams, ZoomDeleteMeetingResponse> =
  {
    id: 'zoom_delete_meeting',
    name: 'Zoom Delete Meeting',
    description: 'Delete or cancel a Zoom meeting',
    version: '1.0.0',

    oauth: {
      required: true,
      provider: 'zoom',
      requiredScopes: ['meeting:delete:meeting'],
    },

    params: {
      meetingId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'The meeting ID to delete (e.g., "1234567890" or "85746065432")',
      },
      occurrenceId: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Occurrence ID for deleting a specific occurrence of a recurring meeting',
      },
      scheduleForReminder: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description: 'Send cancellation reminder email to registrants',
      },
      cancelMeetingReminder: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description: 'Send cancellation email to registrants and alternative hosts',
      },
    },

    request: {
      url: (params) => {
        const baseUrl = `https://api.zoom.us/v2/meetings/${encodeURIComponent(params.meetingId)}`
        const queryParams = new URLSearchParams()

        if (params.occurrenceId) {
          queryParams.append('occurrence_id', params.occurrenceId)
        }
        if (params.scheduleForReminder != null) {
          queryParams.append('schedule_for_reminder', String(params.scheduleForReminder))
        }
        if (params.cancelMeetingReminder != null) {
          queryParams.append('cancel_meeting_reminder', String(params.cancelMeetingReminder))
        }

        const queryString = queryParams.toString()
        return queryString ? `${baseUrl}?${queryString}` : baseUrl
      },
      method: 'DELETE',
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
          output: { success: false },
        }
      }

      // Zoom returns 204 No Content on successful deletion
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
        description: 'Whether the meeting was deleted successfully',
      },
    },
  }
