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
              success
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

    const result = data.data?.deleteTranscript
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
      description: 'Whether the transcript was successfully deleted',
    },
  },
}
