import type {
  AffinityCollectionResponse,
  AffinityListTranscriptsParams,
} from '@/tools/affinity/types'
import { TRANSCRIPT_SUMMARY_OUTPUT_PROPERTIES } from '@/tools/affinity/types'
import { affinityHeaders, buildAffinityUrl, transformCollection } from '@/tools/affinity/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const affinityListTranscriptsTool: ToolConfig<
  AffinityListTranscriptsParams,
  AffinityCollectionResponse<'transcripts'>
> = {
  id: 'affinity_list_transcripts',
  name: 'Affinity List Transcripts',
  description:
    'Page through meeting transcript metadata. Read one transcript to get what was actually said.',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.ERRORS_ARRAY_STRING,

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Affinity API key, sent as a bearer token',
    },
    filter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Affinity Filtering Language expression, e.g. "createdAt>=2026-01-01"',
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
      buildAffinityUrl('/transcripts', {
        filter: params.filter,
        cursor: params.cursor,
        limit: params.limit,
        totalCount: params.totalCount,
      }),
    method: 'GET',
    headers: (params) => affinityHeaders(params.apiKey),
  },

  transformResponse: transformCollection('transcripts'),

  outputs: {
    transcripts: {
      type: 'array',
      description: 'Transcript metadata, without the spoken content',
      items: { type: 'object', properties: TRANSCRIPT_SUMMARY_OUTPUT_PROPERTIES },
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
