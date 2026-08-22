import type {
  AffinityCollectionResponse,
  AffinityListInferredConnectionsParams,
} from '@/tools/affinity/types'
import { CONNECTION_GROUP_OUTPUT_PROPERTIES } from '@/tools/affinity/types'
import {
  affinityHeaders,
  buildAffinityUrl,
  requireParam,
  transformCollection,
} from '@/tools/affinity/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const affinityListCoworkerConnectionsTool: ToolConfig<
  AffinityListInferredConnectionsParams,
  AffinityCollectionResponse<'connections'>
> = {
  id: 'affinity_list_coworker_connections',
  name: 'Affinity List Coworker Connections',
  description:
    'Find warm paths into a company through shared work history: who in your Affinity data once worked alongside the people you want to reach. Grouped by target, strongest first.',
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
      required: true,
      visibility: 'user-or-llm',
      description:
        'Required scope. The only supported filter is target.currentCompany.id, e.g. "target.currentCompany.id=123"',
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
      description: 'Number of targets to return per page, 1-50. Defaults to 20',
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
      buildAffinityUrl('/inferred-connections/coworkers', {
        filter: requireParam(params.filter, 'filter'),
        cursor: params.cursor,
        limit: params.limit,
        totalCount: params.totalCount,
      }),
    method: 'GET',
    headers: (params) => affinityHeaders(params.apiKey),
  },

  transformResponse: transformCollection('connections'),

  outputs: {
    connections: {
      type: 'array',
      description: 'Targets and the coworkers who might introduce you',
      items: { type: 'object', properties: CONNECTION_GROUP_OUTPUT_PROPERTIES },
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
