import {
  type GoogleMeetApiSpaceResponse,
  type GoogleMeetGetSpaceParams,
  type GoogleMeetGetSpaceResponse,
  MEET_API_BASE,
} from '@/tools/google_meet/types'
import type { ToolConfig } from '@/tools/types'

export const getSpaceTool: ToolConfig<GoogleMeetGetSpaceParams, GoogleMeetGetSpaceResponse> = {
  id: 'google_meet_get_space',
  name: 'Google Meet Get Space',
  description: 'Get details of a Google Meet meeting space by name or meeting code',
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
    spaceName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Space resource name (spaces/abc123) or meeting code (abc-defg-hij)',
    },
  },

  request: {
    url: (params: GoogleMeetGetSpaceParams) => {
      const trimmed = params.spaceName.trim()
      const name = trimmed.startsWith('spaces/') ? trimmed : `spaces/${trimmed}`
      return `${MEET_API_BASE}/${name}`
    },
    method: 'GET',
    headers: (params: GoogleMeetGetSpaceParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const error = await response.text().catch(() => 'Unknown error')
      throw new Error(`Google Meet API error (${response.status}): ${error}`)
    }
    const data: GoogleMeetApiSpaceResponse = await response.json()

    return {
      success: true,
      output: {
        name: data.name,
        meetingUri: data.meetingUri,
        meetingCode: data.meetingCode,
        accessType: data.config?.accessType ?? null,
        entryPointAccess: data.config?.entryPointAccess ?? null,
        activeConference: data.activeConference?.conferenceRecord ?? null,
      },
    }
  },

  outputs: {
    name: { type: 'string', description: 'Resource name of the space' },
    meetingUri: { type: 'string', description: 'Meeting URL' },
    meetingCode: { type: 'string', description: 'Meeting code' },
    accessType: { type: 'string', description: 'Access type configuration', optional: true },
    entryPointAccess: {
      type: 'string',
      description: 'Entry point access configuration',
      optional: true,
    },
    activeConference: {
      type: 'string',
      description: 'Active conference record name',
      optional: true,
    },
  },
}
