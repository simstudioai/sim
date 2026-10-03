import type {
  AffinityCollectionResponse,
  AffinityListListEntryFieldsParams,
} from '@/tools/affinity/types'
import { FIELD_VALUE_OUTPUT_PROPERTIES } from '@/tools/affinity/types'
import {
  affinityHeaders,
  buildAffinityUrl,
  requireId,
  selectFieldScope,
  transformCollection,
} from '@/tools/affinity/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const affinityListListEntryFieldsTool: ToolConfig<
  AffinityListListEntryFieldsParams,
  AffinityCollectionResponse<'fields'>
> = {
  id: 'affinity_list_list_entry_fields',
  name: 'Affinity List List Entry Fields',
  description:
    'Page through every field value on one list row, including the list-specific columns. All fields are returned unless narrowed.',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.ERRORS_ARRAY_STRING,

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Affinity API key, sent as a bearer token',
    },
    listId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The list ID',
    },
    listEntryId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The list entry ID',
    },
    ids: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Restrict to these field IDs. Mutually exclusive with Field Types',
    },
    types: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Restrict to these field categories: enriched, global, list, relationship-intelligence. Mutually exclusive with Field IDs',
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
      description: 'Number of items to return per page, 1-100. Defaults to 20',
    },
  },

  request: {
    url: (params) => {
      const listId = encodeURIComponent(requireId(params.listId, 'listId'))
      const listEntryId = encodeURIComponent(requireId(params.listEntryId, 'listEntryId'))
      return buildAffinityUrl(`/lists/${listId}/list-entries/${listEntryId}/fields`, {
        ...selectFieldScope(params.ids, params.types),
        cursor: params.cursor,
        limit: params.limit,
      })
    },
    method: 'GET',
    headers: (params) => affinityHeaders(params.apiKey),
  },

  transformResponse: transformCollection('fields'),

  outputs: {
    fields: {
      type: 'array',
      description: 'Field values on the list row',
      items: { type: 'object', properties: FIELD_VALUE_OUTPUT_PROPERTIES },
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
  },
}
