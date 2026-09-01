import type {
  AffinityCollectionResponse,
  AffinityListListEntriesParams,
} from '@/tools/affinity/types'
import { LIST_ENTRY_OUTPUT_PROPERTIES } from '@/tools/affinity/types'
import {
  affinityHeaders,
  buildAffinityUrl,
  parseStringList,
  requireId,
  transformCollection,
} from '@/tools/affinity/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const affinityListListEntriesTool: ToolConfig<
  AffinityListListEntriesParams,
  AffinityCollectionResponse<'listEntries'>
> = {
  id: 'affinity_list_list_entries',
  name: 'Affinity List List Entries',
  description:
    'Page through the rows of a list. Rows come back without field data unless Field IDs or Field Types asks for it.',
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
    fieldIds: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Field IDs to return values for, e.g. ["affinity-data-location"]. Mutually exclusive with Field Types',
    },
    fieldTypes: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Field categories to return values for: enriched, global, list, or relationship-intelligence. Mutually exclusive with Field IDs',
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
        `/lists/${encodeURIComponent(requireId(params.listId, 'listId'))}/list-entries`,
        {
          fieldIds: parseStringList(params.fieldIds, 'fieldIds'),
          fieldTypes: parseStringList(params.fieldTypes, 'fieldTypes'),
          cursor: params.cursor,
          limit: params.limit,
        }
      ),
    method: 'GET',
    headers: (params) => affinityHeaders(params.apiKey),
  },

  transformResponse: transformCollection('listEntries'),

  outputs: {
    listEntries: {
      type: 'array',
      description: 'Rows on the list, each with its entity inlined',
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
