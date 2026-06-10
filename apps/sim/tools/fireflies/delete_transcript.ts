import type {
  FirefliesDeleteTranscriptParams,
  FirefliesDeleteTranscriptResponse,
} from '@/tools/fireflies/types'
import type { ToolConfig } from '@/tools/types'

export const firefliesDeleteTranscriptTool: ToolConfig<
  FirefliesDeleteTranscriptParams,
  FirefliesDeleteTranscriptResponse
> = {
  id: 'fireflies_delete_transcript',
  name: 'Fireflies Delete Transcript',
  description: 'Delete a transcript from Fireflies.ai',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Fireflies API key',
    },
    transcriptId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The transcript ID to delete (e.g., "abc123def456")',
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
      if (!params.transcriptId) {
        throw new Error('Transcript ID is required')
      }

      return {
        query: `
          mutation DeleteTranscript($id: String!) {
            deleteTranscript(id: $id) {
              id
              title
              date
              duration
              host_email
              organizer_email
            }
          }
        `,
        variables: {
          id: params.transcriptId,
        },
      }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (data.errors) {
      return {
        success: false,
        error: data.errors[0]?.message || 'Failed to delete transcript',
        output: {},
      }
    }

    const deleted = data.data?.deleteTranscript
    if (!deleted) {
      return {
        success: false,
        error: 'Failed to delete transcript',
        output: { success: false },
      }
    }

    return {
      success: true,
      output: {
        success: true,
        transcript: {
          id: deleted.id,
          title: deleted.title ?? null,
          date: deleted.date ?? null,
          duration: deleted.duration ?? null,
          host_email: deleted.host_email ?? null,
          organizer_email: deleted.organizer_email ?? null,
        },
      },
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether the transcript was successfully deleted',
    },
    transcript: {
      type: 'object',
      description: 'The deleted transcript',
      optional: true,
      properties: {
        id: { type: 'string', description: 'Transcript ID' },
        title: { type: 'string', description: 'Meeting title' },
        date: { type: 'number', description: 'Meeting timestamp' },
        duration: { type: 'number', description: 'Meeting duration' },
        host_email: { type: 'string', description: 'Host email address' },
        organizer_email: { type: 'string', description: 'Organizer email address' },
      },
    },
  },
}
