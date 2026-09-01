import {
  type CirclebackListMeetingsParams,
  type CirclebackMeetingListResponse,
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

export const listMeetingsTool: ToolConfig<
  CirclebackListMeetingsParams,
  CirclebackMeetingListResponse
> = {
  id: 'circleback_list_meetings',
  name: 'Circleback List Meetings',
  description:
    'Lists meetings from Circleback with optional ownership, status, tag, and attendee filters.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Circleback API key',
    },
    ownership: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Which meetings to return: All, Mine, or Shared. Defaults to Mine',
    },
    statuses: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated meeting statuses to filter by',
    },
    tagIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated tag IDs to filter by',
    },
    attendeeProfileIds: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated profile IDs of attendees to filter by',
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
      const url = new URL(`${CIRCLEBACK_API_BASE}/meetings`)
      if (params.ownership) url.searchParams.append('ownership', params.ownership)
      appendListParams(url, 'statuses', toStringList(params.statuses))
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
      description: 'The meetings on this page',
      items: { type: 'object', properties: MEETING_OUTPUT_PROPERTIES },
    },
    nextCursor: {
      type: 'string',
      nullable: true,
      description: 'Pagination cursor for the next page, or null on the last page',
    },
    hasMore: {
      type: 'boolean',
      description: 'Whether another page of meetings is available',
    },
  },
}
