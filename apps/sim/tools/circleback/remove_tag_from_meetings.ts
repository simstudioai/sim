import {
  type CirclebackTaggedMeetingsResponse,
  type CirclebackTagMeetingsParams,
  MEETING_OUTPUT_PROPERTIES,
} from '@/tools/circleback/types'
import {
  CIRCLEBACK_API_BASE,
  circlebackHeaders,
  mapMeeting,
  throwCirclebackError,
  toStringList,
} from '@/tools/circleback/utils'
import type { ToolConfig } from '@/tools/types'

export const removeTagFromMeetingsTool: ToolConfig<
  CirclebackTagMeetingsParams,
  CirclebackTaggedMeetingsResponse
> = {
  id: 'circleback_remove_tag_from_meetings',
  name: 'Circleback Remove Tag from Meetings',
  description:
    'Removes a Circleback tag from one or more meetings and returns the updated meetings.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Circleback API key',
    },
    tagId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The unique identifier of the tag to remove',
    },
    meetingIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated IDs of the meetings to remove the tag from',
    },
  },

  request: {
    url: () => `${CIRCLEBACK_API_BASE}/tag`,
    method: 'DELETE',
    headers: (params) => circlebackHeaders(params.apiKey),
    body: (params) => ({
      tagId: Number(params.tagId),
      meetingIds: toStringList(params.meetingIds),
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) await throwCirclebackError(response)

    const data = await response.json()

    return {
      success: true,
      output: {
        meetings: (Array.isArray(data) ? data : []).map(mapMeeting),
      },
    }
  },

  outputs: {
    meetings: {
      type: 'array',
      description: 'The updated meetings',
      items: { type: 'object', properties: MEETING_OUTPUT_PROPERTIES },
    },
  },
}
