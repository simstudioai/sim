import type { AffinityEntityResponse, AffinityGetTranscriptParams } from '@/tools/affinity/types'
import { TRANSCRIPT_OUTPUT_PROPERTIES } from '@/tools/affinity/types'
import {
  affinityHeaders,
  buildAffinityUrl,
  requireId,
  transformEntity,
} from '@/tools/affinity/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const affinityGetTranscriptTool: ToolConfig<
  AffinityGetTranscriptParams,
  AffinityEntityResponse<Record<string, unknown>>
> = {
  id: 'affinity_get_transcript',
  name: 'Affinity Get Transcript',
  description:
    'Read one transcript with its first 100 fragments. Page the fragments endpoint for a longer meeting.',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.ERRORS_ARRAY_STRING,

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Affinity API key, sent as a bearer token',
    },
    transcriptId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The transcript ID',
    },
  },

  request: {
    url: (params) =>
      buildAffinityUrl(
        `/transcripts/${encodeURIComponent(requireId(params.transcriptId, 'transcriptId'))}`
      ),
    method: 'GET',
    headers: (params) => affinityHeaders(params.apiKey),
  },

  transformResponse: transformEntity(),

  outputs: TRANSCRIPT_OUTPUT_PROPERTIES,
}
