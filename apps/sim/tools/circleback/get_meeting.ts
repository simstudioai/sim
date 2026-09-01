import {
  type CirclebackGetMeetingParams,
  type CirclebackMeetingResponse,
  MEETING_OUTPUT_PROPERTIES,
} from '@/tools/circleback/types'
import {
  CIRCLEBACK_API_BASE,
  circlebackHeaders,
  mapMeeting,
  throwCirclebackError,
} from '@/tools/circleback/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const getMeetingTool: ToolConfig<CirclebackGetMeetingParams, CirclebackMeetingResponse> = {
  id: 'circleback_get_meeting',
  name: 'Circleback Get Meeting',
  description:
    'Gets a Circleback meeting by ID, including notes, attendees, action items, insights, and recording details.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Circleback API key',
    },
    meetingId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The unique identifier of the meeting',
    },
  },

  request: {
    url: (params) =>
      `${CIRCLEBACK_API_BASE}/meeting/${safeUrlPathSegment(params.meetingId, 'meetingId')}`,
    method: 'GET',
    headers: (params) => circlebackHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) await throwCirclebackError(response)

    const data = await response.json()

    return {
      success: true,
      output: mapMeeting(data),
    }
  },

  outputs: MEETING_OUTPUT_PROPERTIES,
}
