import type {
  AffinityCollectionResponse,
  AffinityNoteCollectionParams,
} from '@/tools/affinity/types'
import { COMPANY_REFERENCE_OUTPUT_PROPERTIES } from '@/tools/affinity/types'
import {
  affinityHeaders,
  buildAffinityUrl,
  requireId,
  transformCollection,
} from '@/tools/affinity/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const affinityListNoteAttachedCompaniesTool: ToolConfig<
  AffinityNoteCollectionParams,
  AffinityCollectionResponse<'companies'>
> = {
  id: 'affinity_list_note_attached_companies',
  name: 'Affinity List Note Attached Companies',
  description: 'List the companies directly attached to one note.',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.ERRORS_ARRAY_STRING,

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Affinity API key, sent as a bearer token',
    },
    noteId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The note ID',
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
        `/notes/${encodeURIComponent(requireId(params.noteId, 'noteId'))}/attached-companies`,
        { cursor: params.cursor, limit: params.limit, totalCount: params.totalCount }
      ),
    method: 'GET',
    headers: (params) => affinityHeaders(params.apiKey),
  },

  transformResponse: transformCollection('companies'),

  outputs: {
    companies: {
      type: 'array',
      description: 'Companies attached to the note',
      items: { type: 'object', properties: COMPANY_REFERENCE_OUTPUT_PROPERTIES },
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
