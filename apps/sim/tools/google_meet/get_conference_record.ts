import {
  type GoogleMeetApiConferenceRecordResponse,
  type GoogleMeetGetConferenceRecordParams,
  type GoogleMeetGetConferenceRecordResponse,
  MEET_API_BASE,
} from '@/tools/google_meet/types'
import type { ToolConfig } from '@/tools/types'

export const getConferenceRecordTool: ToolConfig<
  GoogleMeetGetConferenceRecordParams,
  GoogleMeetGetConferenceRecordResponse
> = {
  id: 'google_meet_get_conference_record',
  name: 'Google Meet Get Conference Record',
  description: 'Get details of a specific conference record',
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
  },

  request: {
    url: (params: GoogleMeetGetConferenceRecordParams) => {
      const trimmed = params.conferenceName.trim()
      const name = trimmed.startsWith('conferenceRecords/')
        ? trimmed
        : `conferenceRecords/${trimmed}`
      return `${MEET_API_BASE}/${name}`
    },
    method: 'GET',
    headers: (params: GoogleMeetGetConferenceRecordParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const error = await response.text().catch(() => 'Unknown error')
      throw new Error(`Google Meet API error (${response.status}): ${error}`)
    }
    const data: GoogleMeetApiConferenceRecordResponse = await response.json()

    return {
      success: true,
      output: {
        name: data.name,
        startTime: data.startTime,
        endTime: data.endTime ?? null,
        expireTime: data.expireTime,
        space: data.space,
      },
    }
  },

  outputs: {
    name: { type: 'string', description: 'Conference record resource name' },
    startTime: { type: 'string', description: 'Conference start time' },
    endTime: { type: 'string', description: 'Conference end time', optional: true },
    expireTime: { type: 'string', description: 'Conference record expiration time' },
    space: { type: 'string', description: 'Associated space resource name' },
  },
}
