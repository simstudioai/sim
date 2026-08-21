import type { AffinityCollectionResponse, AffinityListListsParams } from '@/tools/affinity/types'
import { LIST_WITH_TYPE_OUTPUT_PROPERTIES } from '@/tools/affinity/types'
import { affinityHeaders, buildAffinityUrl, transformCollection } from '@/tools/affinity/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const affinityListListsTool: ToolConfig<
  AffinityListListsParams,
  AffinityCollectionResponse<'lists'>
> = {
  id: 'affinity_list_lists',
  name: 'Affinity List Lists',
  description: 'Page through the lists in the organization that the caller can view.',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.ERRORS_ARRAY_STRING,

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Affinity API key, sent as a bearer token',
    },
    term: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Case-insensitive substring match on the list name',
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
      buildAffinityUrl('/lists', {
        term: params.term,
        cursor: params.cursor,
        limit: params.limit,
      }),
    method: 'GET',
    headers: (params) => affinityHeaders(params.apiKey),
  },

  transformResponse: transformCollection('lists'),

  outputs: {
    lists: {
      type: 'array',
      description: 'Lists the caller can view',
      items: { type: 'object', properties: LIST_WITH_TYPE_OUTPUT_PROPERTIES },
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
