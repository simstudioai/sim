import type {
  AffinityCollectionResponse,
  AffinityListTranscriptFragmentsParams,
} from '@/tools/affinity/types'
import { TRANSCRIPT_FRAGMENT_OUTPUT_PROPERTIES } from '@/tools/affinity/types'
import {
  affinityHeaders,
  buildAffinityUrl,
  requireId,
  transformCollection,
} from '@/tools/affinity/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const affinityListTranscriptFragmentsTool: ToolConfig<
  AffinityListTranscriptFragmentsParams,
  AffinityCollectionResponse<'fragments'>
> = {
  id: 'affinity_list_transcript_fragments',
  name: 'Affinity List Transcript Fragments',
  description: 'Page through everything said in a meeting, segment by segment with the speaker.',
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
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Cursor from a previous page, returned as nextCursor or prevCursor',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of items to return per page, 1-100. Defaults to 100',
    },
    totalCount: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include the total size of the collection. Costs an extra query',
    },
  },

  request: {
    url: (params) =>
      buildAffinityUrl(
        `/transcripts/${encodeURIComponent(requireId(params.transcriptId, 'transcriptId'))}/fragments`,
        { cursor: params.cursor, limit: params.limit, totalCount: params.totalCount }
      ),
    method: 'GET',
    headers: (params) => affinityHeaders(params.apiKey),
  },

  transformResponse: transformCollection('fragments'),

  outputs: {
    fragments: {
      type: 'array',
      description: 'Spoken segments in order',
      items: { type: 'object', properties: TRANSCRIPT_FRAGMENT_OUTPUT_PROPERTIES },
    },
    count: { type: 'number', description: 'Number of rows on this page' },
    nextCursor: {
      type: 'string',
      nullable: true,
      description: 'Cursor for the next page, or null on the last page',
    },
    prevCursor: {
      type: 'string',
      nullable: true,
      description: 'Cursor for the previous page, or null on the first page',
    },
    totalCount: {
      type: 'number',
      nullable: true,
      description: 'Total size of the collection, only when Total Count was requested',
    },
  },
}
