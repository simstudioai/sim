import type {
  AffinityCollectionResponse,
  AffinityListSavedViewsParams,
} from '@/tools/affinity/types'
import { SAVED_VIEW_OUTPUT_PROPERTIES } from '@/tools/affinity/types'
import {
  affinityHeaders,
  buildAffinityUrl,
  requireId,
  transformCollection,
} from '@/tools/affinity/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const affinityListSavedViewsTool: ToolConfig<
  AffinityListSavedViewsParams,
  AffinityCollectionResponse<'savedViews'>
> = {
  id: 'affinity_list_saved_views',
  name: 'Affinity List Saved Views',
  description: 'List the saved views on a list that the caller can view.',
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
    url: (params) =>
      buildAffinityUrl(
        `/lists/${encodeURIComponent(requireId(params.listId, 'listId'))}/saved-views`,
        { cursor: params.cursor, limit: params.limit }
      ),
    method: 'GET',
    headers: (params) => affinityHeaders(params.apiKey),
  },

  transformResponse: transformCollection('savedViews'),

  outputs: {
    savedViews: {
      type: 'array',
      description: 'Saved views on the list',
      items: { type: 'object', properties: SAVED_VIEW_OUTPUT_PROPERTIES },
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
