import type { ToolConfig } from '@/tools/types'
import type {
  ZoomGetMeetingInvitationParams,
  ZoomGetMeetingInvitationResponse,
} from '@/tools/zoom/types'

export const zoomGetMeetingInvitationTool: ToolConfig<
  ZoomGetMeetingInvitationParams,
  ZoomGetMeetingInvitationResponse
> = {
  id: 'zoom_get_meeting_invitation',
  name: 'Zoom Get Meeting Invitation',
  description: 'Get the meeting invitation text for a Zoom meeting',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'zoom',
    requiredScopes: ['meeting:read:invitation'],
  },

  params: {
    meetingId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The meeting ID (e.g., "1234567890" or "85746065432")',
    },
  },

  request: {
    url: (params) =>
      `https://api.zoom.us/v2/meetings/${encodeURIComponent(params.meetingId)}/invitation`,
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
        output: { invitation: '' },
      }
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        invitation: data.invitation || '',
      },
    }
  },

  outputs: {
    invitation: {
      type: 'string',
      description: 'The meeting invitation text',
    },
  },
}
