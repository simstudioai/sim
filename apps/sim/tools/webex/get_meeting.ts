import type { ToolConfig } from '@/tools/types'
import type { WebexGetMeetingParams, WebexGetMeetingResponse } from '@/tools/webex/types'
import { MEETING_OUTPUT_PROPERTIES } from '@/tools/webex/types'

export const webexGetMeetingTool: ToolConfig<WebexGetMeetingParams, WebexGetMeetingResponse> = {
  id: 'webex_get_meeting',
  name: 'Webex Get Meeting',
  description: 'Get details of a specific Webex meeting by its ID.',
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
    meetingId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The meeting ID to retrieve',
    },
  },

  request: {
    url: (params) => `https://webexapis.com/v1/meetings/${encodeURIComponent(params.meetingId)}`,
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
        output: { meeting: {} },
      }
    }
    const data = await response.json()
    return { success: true, output: { meeting: data } }
  },

  outputs: {
    meeting: {
      type: 'object',
      description: 'The meeting object',
      properties: MEETING_OUTPUT_PROPERTIES,
    },
  },
}
