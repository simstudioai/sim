import type { GrainGetTranscriptParams, GrainGetTranscriptResponse } from '@/tools/grain/types'
import type { ToolConfig } from '@/tools/types'

export const grainGetTranscriptTool: ToolConfig<
  GrainGetTranscriptParams,
  GrainGetTranscriptResponse
> = {
  id: 'grain_get_transcript',
  name: 'Grain Get Transcript',
  description: 'Get the full transcript of a recording',
  version: '1.0.0',

  oauth: {
    required: true,
    provider: 'grain',
  },

  params: {
    accessToken: {
      type: 'string',
      required: false,
      visibility: 'hidden',
      description: 'OAuth access token (auto-injected)',
    },
    recordingId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The recording UUID',
    },
  },

  request: {
    url: (params) =>
      `https://api.grain.com/_/public-api/v2/recordings/${params.recordingId}/transcript`,
    method: 'GET',
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Missing access token for Grain API request')
      }
      return {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.accessToken}`,
        'Public-Api-Version': '2025-10-31',
      }
    },
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || data.message || 'Failed to get transcript')
    }

    // API returns array directly
    return {
      success: true,
      output: {
        transcript: Array.isArray(data) ? data : [],
      },
    }
  },

  outputs: {
    transcript: {
      type: 'array',
      description: 'Array of transcript sections',
      items: {
        type: 'object',
        properties: {
          participant_id: { type: 'string', description: 'Participant UUID (nullable)' },
          speaker: { type: 'string', description: 'Speaker name' },
          start: { type: 'number', description: 'Start timestamp in ms' },
          end: { type: 'number', description: 'End timestamp in ms' },
          text: { type: 'string', description: 'Transcript text' },
        },
      },
    },
  },
}
