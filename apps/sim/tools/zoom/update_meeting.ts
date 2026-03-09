import type { ToolConfig } from '@/tools/types'
import type { ZoomUpdateMeetingParams, ZoomUpdateMeetingResponse } from '@/tools/zoom/types'

export const zoomUpdateMeetingTool: ToolConfig<ZoomUpdateMeetingParams, ZoomUpdateMeetingResponse> =
  {
    id: 'zoom_update_meeting',
    name: 'Zoom Update Meeting',
    description: 'Update an existing Zoom meeting',
    version: '1.0.0',

    oauth: {
      required: true,
      provider: 'zoom',
      requiredScopes: ['meeting:update:meeting'],
    },

    params: {
      meetingId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'The meeting ID to update (e.g., "1234567890" or "85746065432")',
      },
      topic: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Meeting topic (e.g., "Weekly Team Standup" or "Project Review")',
      },
      type: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description:
          'Meeting type: 1=instant, 2=scheduled, 3=recurring no fixed time, 8=recurring fixed time',
      },
      startTime: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Meeting start time in ISO 8601 format (e.g., 2025-06-03T10:00:00Z)',
      },
      duration: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Meeting duration in minutes (e.g., 30, 60, 90)',
      },
      timezone: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Timezone for the meeting (e.g., America/Los_Angeles)',
      },
      password: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Meeting password',
      },
      agenda: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Meeting agenda or description text',
      },
      hostVideo: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description: 'Start with host video on',
      },
      participantVideo: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description: 'Start with participant video on',
      },
      joinBeforeHost: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description: 'Allow participants to join before host',
      },
      muteUponEntry: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description: 'Mute participants upon entry',
      },
      waitingRoom: {
        type: 'boolean',
        required: false,
        visibility: 'user-or-llm',
        description: 'Enable waiting room',
      },
      autoRecording: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Auto recording setting: local, cloud, or none',
      },
    },

    request: {
      url: (params) => `https://api.zoom.us/v2/meetings/${encodeURIComponent(params.meetingId)}`,
      method: 'PATCH',
      headers: (params) => {
        if (!params.accessToken) {
          throw new Error('Missing access token for Zoom API request')
        }
        return {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${params.accessToken}`,
        }
      },
      body: (params) => {
        const body: Record<string, any> = {}

        if (params.topic) {
          body.topic = params.topic
        }
        if (params.type != null) {
          body.type = params.type
        }
        if (params.startTime) {
          body.start_time = params.startTime
        }
        if (params.duration != null) {
          body.duration = params.duration
        }
        if (params.timezone) {
          body.timezone = params.timezone
        }
        if (params.password) {
          body.password = params.password
        }
        if (params.agenda) {
          body.agenda = params.agenda
        }

        // Build settings object
        const settings: Record<string, any> = {}
        if (params.hostVideo != null) {
          settings.host_video = params.hostVideo
        }
        if (params.participantVideo != null) {
          settings.participant_video = params.participantVideo
        }
        if (params.joinBeforeHost != null) {
          settings.join_before_host = params.joinBeforeHost
        }
        if (params.muteUponEntry != null) {
          settings.mute_upon_entry = params.muteUponEntry
        }
        if (params.waitingRoom != null) {
          settings.waiting_room = params.waitingRoom
        }
        if (params.autoRecording) {
          settings.auto_recording = params.autoRecording
        }

        if (Object.keys(settings).length > 0) {
          body.settings = settings
        }

        return body
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

      // Zoom returns 204 No Content on successful update
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
        description: 'Whether the meeting was updated successfully',
      },
    },
  }
