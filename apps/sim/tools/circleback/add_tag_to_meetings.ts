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

export const addTagToMeetingsTool: ToolConfig<
  CirclebackTagMeetingsParams,
  CirclebackTaggedMeetingsResponse
> = {
  id: 'circleback_add_tag_to_meetings',
  name: 'Circleback Add Tag to Meetings',
  description:
    'Applies an existing Circleback tag to one or more meetings and returns the updated meetings.',
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
      description: 'The unique identifier of the tag to apply',
    },
    meetingIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated IDs of the meetings to tag',
    },
  },

  request: {
    url: () => `${CIRCLEBACK_API_BASE}/tag`,
    method: 'PUT',
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
