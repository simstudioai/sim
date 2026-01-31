import type { ToolConfig } from '@/tools/types'
import type {
  ZoomListPastParticipantsParams,
  ZoomListPastParticipantsResponse,
} from '@/tools/zoom/types'
import {
  PARTICIPANT_OUTPUT_PROPERTIES,
  PARTICIPANT_PAGE_INFO_OUTPUT_PROPERTIES,
} from '@/tools/zoom/types'

export const zoomListPastParticipantsTool: ToolConfig<
  ZoomListPastParticipantsParams,
  ZoomListPastParticipantsResponse
> = {
  id: 'zoom_list_past_participants',
  name: 'Zoom List Past Participants',
  description: 'List participants from a past Zoom meeting',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'zoom',
    requiredScopes: ['meeting:read:list_past_participants'],
  },

  params: {
    meetingId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The past meeting ID or UUID (e.g., "1234567890" or "4444AAABBBccccc12345==")',
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
      const baseUrl = `https://api.zoom.us/v2/past_meetings/${encodeURIComponent(params.meetingId)}/participants`
      const queryParams = new URLSearchParams()

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
          participants: [],
          pageInfo: {
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
        participants: (data.participants || []).map((participant: any) => ({
          id: participant.id,
          user_id: participant.user_id,
          name: participant.name,
          user_email: participant.user_email,
          join_time: participant.join_time,
          leave_time: participant.leave_time,
          duration: participant.duration,
          attentiveness_score: participant.attentiveness_score,
          failover: participant.failover,
          status: participant.status,
        })),
        pageInfo: {
          pageSize: data.page_size || 0,
          totalRecords: data.total_records || 0,
          nextPageToken: data.next_page_token,
        },
      },
    }
  },

  outputs: {
    participants: {
      type: 'array',
      description: 'List of meeting participants',
      items: {
        type: 'object',
        properties: PARTICIPANT_OUTPUT_PROPERTIES,
      },
    },
    pageInfo: {
      type: 'object',
      description: 'Pagination information',
      properties: PARTICIPANT_PAGE_INFO_OUTPUT_PROPERTIES,
    },
  },
}
