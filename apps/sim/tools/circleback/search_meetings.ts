import {
  type CirclebackMeetingListResponse,
  type CirclebackSearchMeetingsParams,
  MEETING_OUTPUT_PROPERTIES,
} from '@/tools/circleback/types'
import {
  appendListParams,
  CIRCLEBACK_API_BASE,
  circlebackHeaders,
  mapMeeting,
  parseNextCursor,
  throwCirclebackError,
  toIdList,
  toStringList,
} from '@/tools/circleback/utils'
import type { ToolConfig } from '@/tools/types'

export const searchMeetingsTool: ToolConfig<
  CirclebackSearchMeetingsParams,
  CirclebackMeetingListResponse
> = {
  id: 'circleback_search_meetings',
  name: 'Circleback Search Meetings',
  description:
    'Searches Circleback meetings by name and content, with optional filters for specific meetings, tags, and people.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Circleback API key',
    },
    searchTerm: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'The text to search for across meeting names and content',
    },
    meetingIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated meeting IDs to restrict the search to',
    },
    tagIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated tag IDs to restrict the search to',
    },
    attendeeProfileIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated profile IDs of attendees to restrict the search to',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor from a previous response',
    },
  },

  request: {
    url: (params) => {
      const url = new URL(`${CIRCLEBACK_API_BASE}/search`)
      if (params.searchTerm) url.searchParams.append('searchTerm', params.searchTerm)
      appendListParams(url, 'meetingIds', toStringList(params.meetingIds))
      appendListParams(url, 'tagIds', toIdList(params.tagIds))
      appendListParams(url, 'attendeeProfileIds', toIdList(params.attendeeProfileIds))
      if (params.cursor) url.searchParams.append('cursor', params.cursor)
      return url.toString()
    },
    method: 'GET',
    headers: (params) => circlebackHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) await throwCirclebackError(response)

    const data = await response.json()
    const nextCursor = parseNextCursor(response)

    return {
      success: true,
      output: {
        meetings: (Array.isArray(data) ? data : []).map(mapMeeting),
        nextCursor,
        hasMore: nextCursor !== null,
      },
    }
  },

  outputs: {
    meetings: {
      type: 'array',
      description: 'The matching meetings on this page',
      items: { type: 'object', properties: MEETING_OUTPUT_PROPERTIES },
    },
    nextCursor: {
      type: 'string',
      description: 'Pagination cursor for the next page',
      optional: true,
    },
    hasMore: {
      type: 'boolean',
      description: 'Whether another page of results is available',
    },
  },
}
