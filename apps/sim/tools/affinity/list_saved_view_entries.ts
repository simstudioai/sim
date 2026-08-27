import type {
  AffinityCollectionResponse,
  AffinityListSavedViewEntriesParams,
} from '@/tools/affinity/types'
import { LIST_ENTRY_OUTPUT_PROPERTIES } from '@/tools/affinity/types'
import {
  affinityHeaders,
  buildAffinityUrl,
  requireId,
  transformCollection,
} from '@/tools/affinity/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const affinityListSavedViewEntriesTool: ToolConfig<
  AffinityListSavedViewEntriesParams,
  AffinityCollectionResponse<'listEntries'>
> = {
  id: 'affinity_list_saved_view_entries',
  name: 'Affinity List Saved View Entries',
  description:
    "Page through the rows of a saved view. The view's own filters and columns decide which rows and which field data come back.",
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
    viewId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The saved view ID',
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
      const viewId = encodeURIComponent(requireId(params.viewId, 'viewId'))
      return buildAffinityUrl(`/lists/${listId}/saved-views/${viewId}/list-entries`, {
        cursor: params.cursor,
        limit: params.limit,
      })
    },
    method: 'GET',
    headers: (params) => affinityHeaders(params.apiKey),
  },

  transformResponse: transformCollection('listEntries'),

  outputs: {
    listEntries: {
      type: 'array',
      description: 'Rows the saved view exposes',
      items: { type: 'object', properties: LIST_ENTRY_OUTPUT_PROPERTIES },
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
