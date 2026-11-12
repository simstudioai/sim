import type { ToolConfig } from '@/tools/types'
import type { WebexUpdateMeetingParams, WebexUpdateMeetingResponse } from '@/tools/webex/types'
import { MEETING_OUTPUT_PROPERTIES } from '@/tools/webex/types'

export const webexUpdateMeetingTool: ToolConfig<
  WebexUpdateMeetingParams,
  WebexUpdateMeetingResponse
> = {
  id: 'webex_update_meeting',
  name: 'Webex Update Meeting',
  description: 'Update an existing Webex meeting.',
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
    meetingId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The meeting ID to update',
    },
    title: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New meeting title',
    },
    start: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New start time in ISO 8601 format',
    },
    end: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New end time in ISO 8601 format',
    },
    agenda: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New agenda',
    },
    password: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New meeting password',
    },
    timezone: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'New timezone (e.g., Europe/Paris)',
    },
    enabledAutoRecordMeeting: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Toggle auto-record',
    },
  },

  request: {
    url: (params) => `https://webexapis.com/v1/meetings/${encodeURIComponent(params.meetingId)}`,
    method: 'PUT',
    headers: (params) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {}
      if (params.title) body.title = params.title
      if (params.start) body.start = params.start
      if (params.end) body.end = params.end
      if (params.agenda) body.agenda = params.agenda
      if (params.password) body.password = params.password
      if (params.timezone) body.timezone = params.timezone
      if (params.enabledAutoRecordMeeting != null)
        body.enabledAutoRecordMeeting = params.enabledAutoRecordMeeting
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
      description: 'The updated meeting object',
      properties: MEETING_OUTPUT_PROPERTIES,
    },
  },
}
