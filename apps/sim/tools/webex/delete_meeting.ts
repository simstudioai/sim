import type { ToolConfig } from '@/tools/types'
import type { WebexDeleteMeetingParams, WebexDeleteMeetingResponse } from '@/tools/webex/types'

export const webexDeleteMeetingTool: ToolConfig<
  WebexDeleteMeetingParams,
  WebexDeleteMeetingResponse
> = {
  id: 'webex_delete_meeting',
  name: 'Webex Delete Meeting',
  description: 'Delete (cancel) a Webex meeting by its ID.',
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
      description: 'The meeting ID to delete',
    },
  },

  request: {
    url: (params) => `https://webexapis.com/v1/meetings/${encodeURIComponent(params.meetingId)}`,
    method: 'DELETE',
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
        output: { success: false },
      }
    }
    return { success: true, output: { success: true } }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the deletion succeeded' },
  },
}
