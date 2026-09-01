import {
  type CirclebackGetTranscriptParams,
  type CirclebackTranscriptResponse,
  TRANSCRIPT_SEGMENT_OUTPUT_PROPERTIES,
} from '@/tools/circleback/types'
import {
  CIRCLEBACK_API_BASE,
  circlebackHeaders,
  throwCirclebackError,
} from '@/tools/circleback/utils'
import type { ToolConfig } from '@/tools/types'
import { safeUrlPathSegment } from '@/tools/url-path'

export const getTranscriptTool: ToolConfig<
  CirclebackGetTranscriptParams,
  CirclebackTranscriptResponse
> = {
  id: 'circleback_get_transcript',
  name: 'Circleback Get Transcript',
  description: 'Gets the full transcript for a Circleback meeting.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Circleback API key',
    },
    meetingId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The unique identifier of the meeting',
    },
  },

  request: {
    url: (params) =>
      `${CIRCLEBACK_API_BASE}/meeting/${safeUrlPathSegment(params.meetingId, 'meetingId')}/transcript`,
    method: 'GET',
    headers: (params) => circlebackHeaders(params.apiKey),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) await throwCirclebackError(response)

    const data = await response.json()

    return {
      success: true,
      output: {
        transcript: (Array.isArray(data) ? data : []).map(
          (segment: { speaker?: string | null; text?: string; timestamp?: number }) => ({
            speaker: segment.speaker ?? null,
            text: segment.text ?? '',
            timestamp: segment.timestamp ?? 0,
          })
        ),
      },
    }
  },

  outputs: {
    transcript: {
      type: 'array',
      description: 'The transcript segments in order',
      items: { type: 'object', properties: TRANSCRIPT_SEGMENT_OUTPUT_PROPERTIES },
    },
  },
}
