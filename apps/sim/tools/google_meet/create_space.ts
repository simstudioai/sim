import {
  type GoogleMeetApiSpaceResponse,
  type GoogleMeetCreateSpaceParams,
  type GoogleMeetCreateSpaceResponse,
  MEET_API_BASE,
} from '@/tools/google_meet/types'
import type { ToolConfig } from '@/tools/types'

export const createSpaceTool: ToolConfig<
  GoogleMeetCreateSpaceParams,
  GoogleMeetCreateSpaceResponse
> = {
  id: 'google_meet_create_space',
  name: 'Google Meet Create Space',
  description: 'Create a new Google Meet meeting space',
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
    accessType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Who can join the meeting without knocking: OPEN (anyone with link), TRUSTED (org members), RESTRICTED (only invited)',
    },
    entryPointAccess: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Entry points allowed: ALL (all entry points) or CREATOR_APP_ONLY (only via app)',
    },
  },

  request: {
    url: () => `${MEET_API_BASE}/spaces`,
    method: 'POST',
    headers: (params: GoogleMeetCreateSpaceParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: (params: GoogleMeetCreateSpaceParams) => {
      const body: Record<string, unknown> = {}

      if (params.accessType || params.entryPointAccess) {
        const config: Record<string, string> = {}
        if (params.accessType) config.accessType = params.accessType
        if (params.entryPointAccess) config.entryPointAccess = params.entryPointAccess
        body.config = config
      }

      return body
    },
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
      },
    }
  },

  outputs: {
    name: { type: 'string', description: 'Resource name of the space (e.g., spaces/abc123)' },
    meetingUri: {
      type: 'string',
      description: 'Meeting URL (e.g., https://meet.google.com/abc-defg-hij)',
    },
    meetingCode: { type: 'string', description: 'Meeting code (e.g., abc-defg-hij)' },
    accessType: { type: 'string', description: 'Access type configuration', optional: true },
    entryPointAccess: {
      type: 'string',
      description: 'Entry point access configuration',
      optional: true,
    },
  },
}
