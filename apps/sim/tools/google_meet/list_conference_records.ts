import {
  type GoogleMeetApiConferenceRecordListResponse,
  type GoogleMeetListConferenceRecordsParams,
  type GoogleMeetListConferenceRecordsResponse,
  MEET_API_BASE,
} from '@/tools/google_meet/types'
import type { ToolConfig } from '@/tools/types'

export const listConferenceRecordsTool: ToolConfig<
  GoogleMeetListConferenceRecordsParams,
  GoogleMeetListConferenceRecordsResponse
> = {
  id: 'google_meet_list_conference_records',
  name: 'Google Meet List Conference Records',
  description: 'List conference records for meetings you organized',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'google-meet',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'Access token for Google Meet API',
    },
    filter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Filter by space name (e.g., space.name = "spaces/abc123") or time range (e.g., start_time > "2024-01-01T00:00:00Z")',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of conference records to return (max 100)',
    },
    pageToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page token from a previous list request',
    },
  },

  request: {
    url: (params: GoogleMeetListConferenceRecordsParams) => {
      const queryParams = new URLSearchParams()
      if (params.filter) queryParams.append('filter', params.filter)
      if (params.pageSize) queryParams.append('pageSize', params.pageSize.toString())
      if (params.pageToken) queryParams.append('pageToken', params.pageToken)

      const queryString = queryParams.toString()
      return `${MEET_API_BASE}/conferenceRecords${queryString ? `?${queryString}` : ''}`
    },
    method: 'GET',
    headers: (params: GoogleMeetListConferenceRecordsParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const error = await response.text().catch(() => 'Unknown error')
      throw new Error(`Google Meet API error (${response.status}): ${error}`)
    }
    const data: GoogleMeetApiConferenceRecordListResponse = await response.json()
    const records = data.conferenceRecords ?? []

    return {
      success: true,
      output: {
        conferenceRecords: records.map((record) => ({
          name: record.name,
          startTime: record.startTime,
          endTime: record.endTime ?? null,
          expireTime: record.expireTime,
          space: record.space,
        })),
        nextPageToken: data.nextPageToken ?? null,
      },
    }
  },

  outputs: {
    conferenceRecords: {
      type: 'json',
      description: 'List of conference records with name, start/end times, and space',
    },
    nextPageToken: {
      type: 'string',
      description: 'Token for next page of results',
      optional: true,
    },
  },
}
