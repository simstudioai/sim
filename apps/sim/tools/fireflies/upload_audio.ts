import type {
  FirefliesUploadAudioParams,
  FirefliesUploadAudioResponse,
} from '@/tools/fireflies/types'
import type { ToolConfig } from '@/tools/types'

export const firefliesUploadAudioTool: ToolConfig<
  FirefliesUploadAudioParams,
  FirefliesUploadAudioResponse
> = {
  id: 'fireflies_upload_audio',
  name: 'Fireflies Upload Audio',
  description: 'Upload an audio file URL to Fireflies.ai for transcription',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Fireflies API key',
    },
    audioFile: {
      type: 'file',
      required: false,
      visibility: 'user-or-llm',
      description: 'Audio/video file to upload for transcription',
    },
    audioUrl: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Public HTTPS URL of the audio/video file (MP3, MP4, WAV, M4A, OGG)',
    },
    title: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Title for the meeting/transcript',
    },
    webhook: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Webhook URL to notify when transcription is complete',
    },
    language: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Language code for transcription (e.g., "es" for Spanish, "de" for German)',
    },
    attendees: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Attendees in JSON format: [{"displayName": "Name", "email": "email@example.com"}]',
    },
    clientReferenceId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Custom reference ID for tracking',
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
      let url: string | undefined

      if (params.audioFile) {
        url = params.audioFile.url || params.audioFile.path
      }

      if (!url && params.audioUrl) {
        url = params.audioUrl
      }

      if (!url) {
        throw new Error('Either an audio file or audio URL is required')
      }

      if (!url.startsWith('https://')) {
        throw new Error('Audio URL must be a valid HTTPS URL')
      }

      const input: Record<string, unknown> = {
        url,
      }

      if (params.title) input.title = params.title
      if (params.webhook) input.webhook = params.webhook
      if (params.language) input.custom_language = params.language
      if (params.clientReferenceId) input.client_reference_id = params.clientReferenceId
      if (params.attendees) {
        try {
          input.attendees = JSON.parse(params.attendees)
        } catch {
          throw new Error('Invalid attendees JSON format')
        }
      }

      return {
        query: `
          mutation UploadAudio($input: AudioUploadInput) {
            uploadAudio(input: $input) {
              success
              title
              message
            }
          }
        `,
        variables: {
          input,
        },
      }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (data.errors) {
      return {
        success: false,
        error: data.errors[0]?.message || 'Failed to upload audio',
        output: {},
      }
    }

    const result = data.data?.uploadAudio
    if (!result) {
      return {
        success: false,
        error: 'Upload failed',
        output: {},
      }
    }

    return {
      success: result.success,
      output: {
        success: result.success,
        title: result.title,
        message: result.message,
      },
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether the upload was successful',
    },
    title: {
      type: 'string',
      description: 'Title of the uploaded meeting',
    },
    message: {
      type: 'string',
      description: 'Status message from Fireflies',
    },
  },
}
