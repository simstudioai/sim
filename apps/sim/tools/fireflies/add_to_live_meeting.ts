import type {
  FirefliesAddToLiveMeetingParams,
  FirefliesAddToLiveMeetingResponse,
} from '@/tools/fireflies/types'
import type { ToolConfig } from '@/tools/types'

export const firefliesAddToLiveMeetingTool: ToolConfig<
  FirefliesAddToLiveMeetingParams,
  FirefliesAddToLiveMeetingResponse
> = {
  id: 'fireflies_add_to_live_meeting',
  name: 'Fireflies Add to Live Meeting',
  description: 'Add the Fireflies.ai bot to an ongoing meeting to record and transcribe',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Fireflies API key',
    },
    meetingLink: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Valid meeting URL (Zoom, Google Meet, Microsoft Teams, etc.)',
    },
    title: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Title for the meeting (max 256 characters)',
    },
    meetingPassword: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Password for the meeting if required (max 32 characters)',
    },
    duration: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Meeting duration in minutes (15-120, default: 60)',
    },
    language: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Language code for transcription (e.g., "en", "es", "de")',
    },
  },

  request: {
    url: 'https://api.fireflies.ai/graphql',
    method: 'POST',
    headers: (params) => {
      if (!params.apiKey) {
        throw new Error('Missing API key for Fireflies API request')
      }
      return {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.apiKey}`,
      }
    },
    body: (params) => {
      if (!params.meetingLink || !params.meetingLink.startsWith('http')) {
        throw new Error('Meeting link must be a valid HTTP/HTTPS URL')
      }

      const variables: Record<string, unknown> = {
        meetingLink: params.meetingLink,
      }

      if (params.title) variables.title = params.title.substring(0, 256)
      if (params.meetingPassword)
        variables.meeting_password = params.meetingPassword.substring(0, 32)
      if (params.duration) {
        const duration = Math.min(Math.max(Number(params.duration), 15), 120)
        variables.duration = duration
      }
      if (params.language) variables.language = params.language.substring(0, 5)

      return {
        query: `
          mutation AddToLiveMeeting(
            $meetingLink: String!
            $title: String
            $meeting_password: String
            $duration: Int
            $language: String
          ) {
            addToLiveMeeting(
              meeting_link: $meetingLink
              title: $title
              meeting_password: $meeting_password
              duration: $duration
              language: $language
            ) {
              success
            }
          }
        `,
        variables,
      }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (data.errors) {
      const error = data.errors[0]
      const errorCode = error?.extensions?.code || ''
      let errorMessage = error?.message || 'Failed to add bot to meeting'

      if (errorCode === 'too_many_requests') {
        errorMessage = 'Rate limit exceeded. This endpoint allows 3 requests per 20 minutes.'
      } else if (errorCode === 'invalid_language_code') {
        errorMessage = 'Invalid language code provided'
      } else if (errorCode === 'unsupported_platform') {
        errorMessage = 'Meeting platform is not supported'
      }

      return {
        success: false,
        error: errorMessage,
        output: {},
      }
    }

    const result = data.data?.addToLiveMeeting
    return {
      success: result?.success ?? false,
      output: {
        success: result?.success ?? false,
      },
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether the bot was successfully added to the meeting',
    },
  },
}
