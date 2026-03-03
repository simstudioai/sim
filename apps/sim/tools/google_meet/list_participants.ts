import {
  type GoogleMeetApiParticipantListResponse,
  type GoogleMeetApiParticipantResponse,
  type GoogleMeetListParticipantsParams,
  type GoogleMeetListParticipantsResponse,
  MEET_API_BASE,
} from '@/tools/google_meet/types'
import type { ToolConfig } from '@/tools/types'

export const listParticipantsTool: ToolConfig<
  GoogleMeetListParticipantsParams,
  GoogleMeetListParticipantsResponse
> = {
  id: 'google_meet_list_participants',
  name: 'Google Meet List Participants',
  description: 'List participants of a conference record',
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
    conferenceName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Conference record resource name (e.g., conferenceRecords/abc123)',
    },
    filter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter participants (e.g., earliest_start_time > "2024-01-01T00:00:00Z")',
    },
    pageSize: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of participants to return (default 100, max 250)',
    },
    pageToken: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page token from a previous list request',
    },
  },

  request: {
    url: (params: GoogleMeetListParticipantsParams) => {
      const trimmed = params.conferenceName.trim()
      const name = trimmed.startsWith('conferenceRecords/')
        ? trimmed
        : `conferenceRecords/${trimmed}`

      const queryParams = new URLSearchParams()
      if (params.filter) queryParams.append('filter', params.filter)
      if (params.pageSize) queryParams.append('pageSize', params.pageSize.toString())
      if (params.pageToken) queryParams.append('pageToken', params.pageToken)

      const queryString = queryParams.toString()
      return `${MEET_API_BASE}/${name}/participants${queryString ? `?${queryString}` : ''}`
    },
    method: 'GET',
    headers: (params: GoogleMeetListParticipantsParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const error = await response.text().catch(() => 'Unknown error')
      throw new Error(`Google Meet API error (${response.status}): ${error}`)
    }
    const data: GoogleMeetApiParticipantListResponse = await response.json()
    const participants = data.participants ?? []

    const getDisplayName = (p: GoogleMeetApiParticipantResponse): string | null => {
      return (
        p.signedinUser?.displayName ??
        p.anonymousUser?.displayName ??
        p.phoneUser?.displayName ??
        null
      )
    }

    const getUserType = (p: GoogleMeetApiParticipantResponse): string => {
      if (p.signedinUser) return 'signed_in'
      if (p.anonymousUser) return 'anonymous'
      if (p.phoneUser) return 'phone'
      return 'unknown'
    }

    return {
      success: true,
      output: {
        participants: participants.map((p) => ({
          name: p.name,
          earliestStartTime: p.earliestStartTime,
          latestEndTime: p.latestEndTime ?? null,
          displayName: getDisplayName(p),
          userType: getUserType(p),
        })),
        nextPageToken: data.nextPageToken ?? null,
        totalSize: data.totalSize ?? null,
      },
    }
  },

  outputs: {
    participants: {
      type: 'json',
      description: 'List of participants with name, times, display name, and user type',
    },
    nextPageToken: {
      type: 'string',
      description: 'Token for next page of results',
      optional: true,
    },
    totalSize: { type: 'number', description: 'Total number of participants', optional: true },
  },
}
