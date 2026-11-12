import type { ToolConfig } from '@/tools/types'
import type { WebexListMeetingsParams, WebexListMeetingsResponse } from '@/tools/webex/types'
import { MEETINGS_LIST_OUTPUT } from '@/tools/webex/types'

export const webexListMeetingsTool: ToolConfig<WebexListMeetingsParams, WebexListMeetingsResponse> =
  {
    id: 'webex_list_meetings',
    name: 'Webex List Meetings',
    description: 'List Webex meetings for the authenticated user.',
    version: '1.0.0',

    oauth: {
      required: true,
      provider: 'webex',
      requiredScopes: ['meeting:schedules_read'],
    },

    params: {
      accessToken: {
        type: 'string',
        required: true,
        visibility: 'hidden',
        description: 'OAuth access token for Webex API',
      },
      max: {
        type: 'number',
        required: false,
        visibility: 'user-or-llm',
        description: 'Maximum number of meetings to return (1-100)',
      },
      from: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Start of date range in ISO 8601 format',
      },
      to: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'End of date range in ISO 8601 format',
      },
      meetingType: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'Meeting type filter: scheduledMeeting, meeting, webinar',
      },
      state: {
        type: 'string',
        required: false,
        visibility: 'user-or-llm',
        description: 'State filter: scheduled, ready, lobby, inProgress, ended, missed, expired',
      },
    },

    request: {
      url: (params) => {
        const query = new URLSearchParams()
        if (params.max) query.set('max', String(params.max))
        if (params.from) query.set('from', params.from)
        if (params.to) query.set('to', params.to)
        if (params.meetingType) query.set('meetingType', params.meetingType)
        if (params.state) query.set('state', params.state)
        const qs = query.toString()
        return `https://webexapis.com/v1/meetings${qs ? `?${qs}` : ''}`
      },
      method: 'GET',
      headers: (params) => ({
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      }),
    },

    transformResponse: async (response) => {
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        return {
          success: false,
          error:
            (errorData as { message?: string }).message ||
            `Webex API error: ${response.status} ${response.statusText}`,
          output: { meetings: [] },
        }
      }
      const data = await response.json()
      return { success: true, output: { meetings: data.items ?? [] } }
    },

    outputs: { meetings: MEETINGS_LIST_OUTPUT },
  }
