import type {
  FirefliesCreateBiteParams,
  FirefliesCreateBiteResponse,
} from '@/tools/fireflies/types'
import type { ToolConfig } from '@/tools/types'

export const firefliesCreateBiteTool: ToolConfig<
  FirefliesCreateBiteParams,
  FirefliesCreateBiteResponse
> = {
  id: 'fireflies_create_bite',
  name: 'Fireflies Create Bite',
  description: 'Create a soundbite/highlight from a specific time range in a transcript',
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
      description: 'ID of the transcript to create the bite from (e.g., "abc123def456")',
    },
    startTime: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'Start time of the bite in seconds',
    },
    endTime: {
      type: 'number',
      required: true,
      visibility: 'user-or-llm',
      description: 'End time of the bite in seconds',
    },
    name: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Name for the bite (max 256 characters)',
    },
    mediaType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Media type: "video" or "audio"',
    },
    summary: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Summary for the bite (max 500 characters)',
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
      if (params.startTime === undefined || params.endTime === undefined) {
        throw new Error('Start time and end time are required')
      }
      if (params.startTime >= params.endTime) {
        throw new Error('Start time must be less than end time')
      }

      const variables: Record<string, unknown> = {
        transcriptId: params.transcriptId,
        startTime: Number(params.startTime),
        endTime: Number(params.endTime),
      }

      if (params.name) variables.name = params.name.substring(0, 256)
      if (params.mediaType) variables.media_type = params.mediaType
      if (params.summary) variables.summary = params.summary.substring(0, 500)

      return {
        query: `
          mutation CreateBite(
            $transcriptId: ID!
            $startTime: Float!
            $endTime: Float!
            $name: String
            $media_type: String
            $summary: String
          ) {
            createBite(
              transcript_Id: $transcriptId
              start_time: $startTime
              end_time: $endTime
              name: $name
              media_type: $media_type
              summary: $summary
            ) {
              id
              name
              status
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
      return {
        success: false,
        error: data.errors[0]?.message || 'Failed to create bite',
        output: {},
      }
    }

    const bite = data.data?.createBite
    if (!bite) {
      return {
        success: false,
        error: 'Failed to create bite',
        output: {},
      }
    }

    return {
      success: true,
      output: {
        bite: {
          id: bite.id,
          name: bite.name,
          status: bite.status,
        },
      },
    }
  },

  outputs: {
    bite: {
      type: 'object',
      description: 'Created bite details',
      properties: {
        id: { type: 'string', description: 'Bite ID' },
        name: { type: 'string', description: 'Bite name' },
        status: { type: 'string', description: 'Processing status' },
      },
    },
  },
}
