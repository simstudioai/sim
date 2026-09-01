import {
  type CirclebackDeleteMeetingParams,
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

export const deleteMeetingTool: ToolConfig<
  CirclebackDeleteMeetingParams,
  CirclebackMeetingResponse
> = {
  id: 'circleback_delete_meeting',
  name: 'Circleback Delete Meeting',
  description:
    'Deletes a Circleback meeting. Only the owner of the meeting can delete it. Returns the deleted meeting.',
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
    method: 'DELETE',
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
