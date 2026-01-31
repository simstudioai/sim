import type { ToolConfig } from '@/tools/types'
import type { ZoomListRecordingsParams, ZoomListRecordingsResponse } from '@/tools/zoom/types'
import {
  RECORDING_OUTPUT_PROPERTIES,
  RECORDING_PAGE_INFO_OUTPUT_PROPERTIES,
} from '@/tools/zoom/types'

export const zoomListRecordingsTool: ToolConfig<
  ZoomListRecordingsParams,
  ZoomListRecordingsResponse
> = {
  id: 'zoom_list_recordings',
  name: 'Zoom List Recordings',
  description: 'List all cloud recordings for a Zoom user',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'zoom',
    requiredScopes: ['cloud_recording:read:list_user_recordings'],
  },

  params: {
    userId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'The user ID or email address (e.g., "me", "user@example.com", or "AbcDefGHi"). Use "me" for the authenticated user.',
    },
    from: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Start date in yyyy-mm-dd format (within last 6 months)',
    },
    to: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'End date in yyyy-mm-dd format',
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
    trash: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Set to true to list recordings from trash',
    },
  },

  request: {
    url: (params) => {
      const baseUrl = `https://api.zoom.us/v2/users/${encodeURIComponent(params.userId)}/recordings`
      const queryParams = new URLSearchParams()

      if (params.from) {
        queryParams.append('from', params.from)
      }
      if (params.to) {
        queryParams.append('to', params.to)
      }
      if (params.pageSize) {
        queryParams.append('page_size', String(params.pageSize))
      }
      if (params.nextPageToken) {
        queryParams.append('next_page_token', params.nextPageToken)
      }
      if (params.trash) {
        queryParams.append('trash', 'true')
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
          recordings: [],
          pageInfo: {
            from: '',
            to: '',
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
        recordings: (data.meetings || []).map((recording: any) => ({
          uuid: recording.uuid,
          id: recording.id,
          account_id: recording.account_id,
          host_id: recording.host_id,
          topic: recording.topic,
          type: recording.type,
          start_time: recording.start_time,
          duration: recording.duration,
          total_size: recording.total_size,
          recording_count: recording.recording_count,
          share_url: recording.share_url,
          recording_files: recording.recording_files || [],
        })),
        pageInfo: {
          from: data.from || '',
          to: data.to || '',
          pageSize: data.page_size || 0,
          totalRecords: data.total_records || 0,
          nextPageToken: data.next_page_token,
        },
      },
    }
  },

  outputs: {
    recordings: {
      type: 'array',
      description: 'List of recordings',
      items: {
        type: 'object',
        properties: RECORDING_OUTPUT_PROPERTIES,
      },
    },
    pageInfo: {
      type: 'object',
      description: 'Pagination information',
      properties: RECORDING_PAGE_INFO_OUTPUT_PROPERTIES,
    },
  },
}
