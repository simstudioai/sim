import type {
  AffinityCollectionResponse,
  AffinityListListEntryFieldValueChangesParams,
} from '@/tools/affinity/types'
import { FIELD_VALUE_CHANGE_OUTPUT_PROPERTIES } from '@/tools/affinity/types'
import {
  affinityHeaders,
  buildAffinityUrl,
  requireId,
  transformCollection,
} from '@/tools/affinity/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const affinityListListEntryFieldValueChangesTool: ToolConfig<
  AffinityListListEntryFieldValueChangesParams,
  AffinityCollectionResponse<'changes'>
> = {
  id: 'affinity_list_list_entry_field_value_changes',
  name: 'Affinity List List Entry Field Value Changes',
  description:
    'Page through the history of one list row — who changed which field, when, and to what.',
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
    filter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Affinity Filtering Language expression over field.id, changer.id, changedAt, or actionType, e.g. "field.id=field-1234"',
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
  },

  request: {
    url: (params) => {
      const listId = encodeURIComponent(requireId(params.listId, 'listId'))
      const listEntryId = encodeURIComponent(requireId(params.listEntryId, 'listEntryId'))
      return buildAffinityUrl(`/lists/${listId}/list-entries/${listEntryId}/field-value-changes`, {
        filter: params.filter,
        cursor: params.cursor,
        limit: params.limit,
      })
    },
    method: 'GET',
    headers: (params) => affinityHeaders(params.apiKey),
  },

  transformResponse: transformCollection('changes'),

  outputs: {
    changes: {
      type: 'array',
      description: 'Field value changes on the row',
      items: { type: 'object', properties: FIELD_VALUE_CHANGE_OUTPUT_PROPERTIES },
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
