import type { ToolConfig } from '@/tools/types'
import type { WebexCreateMeetingParams, WebexCreateMeetingResponse } from '@/tools/webex/types'
import { MEETING_OUTPUT_PROPERTIES } from '@/tools/webex/types'

export const webexCreateMeetingTool: ToolConfig<
  WebexCreateMeetingParams,
  WebexCreateMeetingResponse
> = {
  id: 'webex_create_meeting',
  name: 'Webex Create Meeting',
  description: 'Schedule a new Webex meeting.',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'webex',
    requiredScopes: ['meeting:schedules_write'],
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token for Webex API',
    },
    title: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Meeting title (e.g., "Weekly Team Standup")',
    },
    start: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Meeting start time in ISO 8601 format (e.g., 2026-03-01T10:00:00Z)',
    },
    end: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Meeting end time in ISO 8601 format (e.g., 2026-03-01T11:00:00Z)',
    },
    agenda: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Meeting agenda or description',
    },
    password: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Meeting password (letters, digits, and special characters allowed)',
    },
    timezone: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Timezone for start/end times (e.g., America/New_York)',
    },
    enabledAutoRecordMeeting: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Automatically record the meeting',
    },
    allowAnyUserToBeCoHost: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Allow any attendee to become co-host',
    },
    invitees: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated email addresses to invite',
    },
  },

  request: {
    url: 'https://webexapis.com/v1/meetings',
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {
        title: params.title,
        start: params.start,
        end: params.end,
      }
      if (params.agenda) body.agenda = params.agenda
      if (params.password) body.password = params.password
      if (params.timezone) body.timezone = params.timezone
      if (params.enabledAutoRecordMeeting != null)
        body.enabledAutoRecordMeeting = params.enabledAutoRecordMeeting
      if (params.allowAnyUserToBeCoHost != null)
        body.allowAnyUserToBeCoHost = params.allowAnyUserToBeCoHost
      if (params.invitees) {
        body.invitees = params.invitees
          .split(',')
          .map((email) => ({ email: email.trim() }))
          .filter((e) => e.email.length > 0)
      }
      return body
    },
  },

  transformResponse: async (response) => {
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      return {
        success: false,
        error:
          (errorData as { message?: string }).message ||
          `Webex API error: ${response.status} ${response.statusText}`,
        output: { meeting: {} },
      }
    }
    const data = await response.json()
    return { success: true, output: { meeting: data } }
  },

  outputs: {
    meeting: {
      type: 'object',
      description: 'The created meeting object',
      properties: MEETING_OUTPUT_PROPERTIES,
    },
  },
}
