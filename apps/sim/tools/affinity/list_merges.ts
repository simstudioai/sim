import type { AffinityCollectionResponse, AffinityListMergesParams } from '@/tools/affinity/types'
import { MERGE_OUTPUT_PROPERTIES } from '@/tools/affinity/types'
import {
  AFFINITY_MERGE_ENTITY_TYPES,
  AFFINITY_MERGE_PREFIXES,
  affinityHeaders,
  buildAffinityUrl,
  requireOneOf,
  transformCollection,
} from '@/tools/affinity/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const affinityListMergesTool: ToolConfig<
  AffinityListMergesParams,
  AffinityCollectionResponse<'merges'>
> = {
  id: 'affinity_list_merges',
  name: 'Affinity List Merges',
  description:
    'Page through the company or person merges the organization has run, with the status and the records involved in each.',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.ERRORS_ARRAY_STRING,

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Affinity API key, sent as a bearer token',
    },
    entityType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Which merges to list: companies or persons',
    },
    filter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Affinity Filtering Language expression over status or taskId, e.g. "status=failed"',
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
      const entityType = requireOneOf(params.entityType, AFFINITY_MERGE_ENTITY_TYPES, 'entityType')
      return buildAffinityUrl(`/${AFFINITY_MERGE_PREFIXES[entityType]}-merges`, {
        filter: params.filter,
        cursor: params.cursor,
        limit: params.limit,
      })
    },
    method: 'GET',
    headers: (params) => affinityHeaders(params.apiKey),
  },

  transformResponse: transformCollection('merges'),

  outputs: {
    merges: {
      type: 'array',
      description: 'Merges the organization has run',
      items: { type: 'object', properties: MERGE_OUTPUT_PROPERTIES },
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
