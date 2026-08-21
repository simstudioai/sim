import type { AffinityCollectionResponse, AffinityFilterParams } from '@/tools/affinity/types'
import { CALL_OUTPUT_PROPERTIES } from '@/tools/affinity/types'
import { affinityHeaders, buildAffinityUrl, transformCollection } from '@/tools/affinity/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const affinityListCallsTool: ToolConfig<
  AffinityFilterParams,
  AffinityCollectionResponse<'calls'>
> = {
  id: 'affinity_list_calls',
  name: 'Affinity List Calls',
  description:
    'Page through logged calls and their participants. Only calls the API key holder can see are returned.',
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
  },

  request: {
    url: (params) =>
      buildAffinityUrl('/calls', {
        filter: params.filter,
        cursor: params.cursor,
        limit: params.limit,
      }),
    method: 'GET',
    headers: (params) => affinityHeaders(params.apiKey),
  },

  transformResponse: transformCollection('calls'),

  outputs: {
    calls: {
      type: 'array',
      description: 'Logged calls, newest page first',
      items: { type: 'object', properties: CALL_OUTPUT_PROPERTIES },
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
