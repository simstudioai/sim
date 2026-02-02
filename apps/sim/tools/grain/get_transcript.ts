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

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Grain API key (Personal Access Token)',
    },
    recordingId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The recording UUID (e.g., "a1b2c3d4-e5f6-7890-abcd-ef1234567890")',
    },
  },

  request: {
    url: (params) =>
      `https://api.grain.com/_/public-api/v2/recordings/${params.recordingId}/transcript`,
    method: 'GET',
    headers: (params) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
      'Public-Api-Version': '2025-10-31',
    }),
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
