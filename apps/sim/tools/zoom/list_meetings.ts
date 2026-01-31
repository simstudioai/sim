import type { ToolConfig } from '@/tools/types'
import type { ZoomListMeetingsParams, ZoomListMeetingsResponse } from '@/tools/zoom/types'
import {
  MEETING_LIST_ITEM_OUTPUT_PROPERTIES,
  MEETING_PAGE_INFO_OUTPUT_PROPERTIES,
} from '@/tools/zoom/types'

export const zoomListMeetingsTool: ToolConfig<ZoomListMeetingsParams, ZoomListMeetingsResponse> = {
  id: 'zoom_list_meetings',
  name: 'Zoom List Meetings',
  description: 'List all meetings for a Zoom user',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'zoom',
    requiredScopes: ['meeting:read:list_meetings'],
  },

  params: {
    userId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The user ID or email address (e.g., "me", "user@example.com", or "AbcDefGHi"). Use "me" for the authenticated user.',
    },
    type: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Meeting type filter: scheduled, live, upcoming, upcoming_meetings, or previous_meetings',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of records per page, 1-300 (e.g., 30, 50, 100)',
    },
    nextPageToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Token for pagination to get next page of results',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = `https://api.zoom.us/v2/users/${encodeURIComponent(params.userId)}/meetings`
      const queryParams = new URLSearchParams()

      if (params.type) {
        queryParams.append('type', params.type)
      }
      if (params.pageSize) {
        queryParams.append('page_size', String(params.pageSize))
      }
      if (params.nextPageToken) {
        queryParams.append('next_page_token', params.nextPageToken)
      }

      const queryString = queryParams.toString()
      return queryString ? `${baseUrl}?${queryString}` : baseUrl
    },
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
        output: {
          meetings: [],
          pageInfo: {
            pageCount: 0,
            pageNumber: 0,
            pageSize: 0,
            totalRecords: 0,
          },
        },
      }
    }

    const data = await response.json()

    return {
      success: true,
      output: {
        meetings: (data.meetings || []).map((meeting: any) => ({
          id: meeting.id,
          uuid: meeting.uuid,
          host_id: meeting.host_id,
          topic: meeting.topic,
          type: meeting.type,
          start_time: meeting.start_time,
          duration: meeting.duration,
          timezone: meeting.timezone,
          agenda: meeting.agenda,
          created_at: meeting.created_at,
          join_url: meeting.join_url,
        })),
        pageInfo: {
          pageCount: data.page_count || 0,
          pageNumber: data.page_number || 0,
          pageSize: data.page_size || 0,
          totalRecords: data.total_records || 0,
          nextPageToken: data.next_page_token,
        },
      },
    }
  },

  outputs: {
    meetings: {
      type: 'array',
      description: 'List of meetings',
      items: {
        type: 'object',
        properties: MEETING_LIST_ITEM_OUTPUT_PROPERTIES,
      },
    },
    pageInfo: {
      type: 'object',
      description: 'Pagination information',
      properties: MEETING_PAGE_INFO_OUTPUT_PROPERTIES,
    },
  },
}
