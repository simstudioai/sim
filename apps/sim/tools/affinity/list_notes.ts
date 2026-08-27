import type { AffinityCollectionResponse, AffinityListNotesParams } from '@/tools/affinity/types'
import { NOTE_OUTPUT_PROPERTIES } from '@/tools/affinity/types'
import {
  affinityHeaders,
  buildAffinityUrl,
  parseStringList,
  transformCollection,
} from '@/tools/affinity/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const affinityListNotesTool: ToolConfig<
  AffinityListNotesParams,
  AffinityCollectionResponse<'notes'>
> = {
  id: 'affinity_list_notes',
  name: 'Affinity List Notes',
  description: 'Page through every note the caller can see. Replies are excluded.',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.ERRORS_ARRAY_STRING,

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Affinity API key, sent as a bearer token',
    },
    includes: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Extra properties to return, e.g. ["repliesCount","personsPreview","companiesPreview","opportunitiesPreview"]. Those four fields are omitted unless requested here',
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
      buildAffinityUrl('/notes', {
        includes: parseStringList(params.includes, 'includes'),
        filter: params.filter,
        cursor: params.cursor,
        limit: params.limit,
        totalCount: params.totalCount,
      }),
    method: 'GET',
    headers: (params) => affinityHeaders(params.apiKey),
  },

  transformResponse: transformCollection('notes'),

  outputs: {
    notes: {
      type: 'array',
      description: 'Root notes, excluding replies',
      items: { type: 'object', properties: NOTE_OUTPUT_PROPERTIES },
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
