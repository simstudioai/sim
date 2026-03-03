import {
  type GoogleMeetEndConferenceParams,
  type GoogleMeetEndConferenceResponse,
  MEET_API_BASE,
} from '@/tools/google_meet/types'
import type { ToolConfig } from '@/tools/types'

export const endConferenceTool: ToolConfig<
  GoogleMeetEndConferenceParams,
  GoogleMeetEndConferenceResponse
> = {
  id: 'google_meet_end_conference',
  name: 'Google Meet End Conference',
  description: 'End the active conference in a Google Meet space',
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
      description: 'Space resource name (e.g., spaces/abc123)',
    },
  },

  request: {
    url: (params: GoogleMeetEndConferenceParams) => {
      const trimmed = params.spaceName.trim()
      const name = trimmed.startsWith('spaces/') ? trimmed : `spaces/${trimmed}`
      return `${MEET_API_BASE}/${name}:endActiveConference`
    },
    method: 'POST',
    headers: (params: GoogleMeetEndConferenceParams) => ({
      Authorization: `Bearer ${params.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: () => ({}),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const error = await response.text().catch(() => 'Unknown error')
      throw new Error(`Google Meet API error (${response.status}): ${error}`)
    }
    return {
      success: true,
      output: {
        ended: true,
      },
    }
  },

  outputs: {
    ended: { type: 'boolean', description: 'Whether the conference was ended successfully' },
  },
}
