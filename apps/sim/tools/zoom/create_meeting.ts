import type { ToolConfig } from '@/tools/types'
import type { ZoomCreateMeetingParams, ZoomCreateMeetingResponse } from '@/tools/zoom/types'
import { MEETING_OUTPUT_PROPERTIES } from '@/tools/zoom/types'

export const zoomCreateMeetingTool: ToolConfig<ZoomCreateMeetingParams, ZoomCreateMeetingResponse> =
  {
    id: 'zoom_create_meeting',
    name: 'Zoom Create Meeting',
    description: 'Create a new Zoom meeting',
    version: '1.0.0',

    oauth: {
      required: true,
      provider: 'zoom',
      requiredScopes: ['meeting:write:meeting'],
    },

    params: {
      userId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description:
          'The user ID or email address (e.g., "me", "user@example.com", or "AbcDefGHi"). Use "me" for the authenticated user.',
      },
      topic: {
        type: 'string',
        required: true,
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
      url: (params) => `https://api.zoom.us/v2/users/${encodeURIComponent(params.userId)}/meetings`,
      method: 'POST',
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
        if (!params.topic || !params.topic.trim()) {
          throw new Error('Topic is required to create a Zoom meeting')
        }

        const body: Record<string, any> = {
          topic: params.topic,
          type: params.type || 2, // Default to scheduled meeting
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
          },
        },
      }
    },

    outputs: {
      meeting: {
        type: 'object',
        description: 'The created meeting with all its properties',
        properties: MEETING_OUTPUT_PROPERTIES,
      },
    },
  }
