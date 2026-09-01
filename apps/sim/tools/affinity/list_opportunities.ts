import type {
  AffinityCollectionResponse,
  AffinityListOpportunitiesParams,
} from '@/tools/affinity/types'
import { OPPORTUNITY_OUTPUT_PROPERTIES } from '@/tools/affinity/types'
import {
  affinityHeaders,
  buildAffinityUrl,
  parseNumberList,
  transformCollection,
} from '@/tools/affinity/utils'
import { ErrorExtractorId } from '@/tools/error-extractors'
import type { ToolConfig } from '@/tools/types'

export const affinityListOpportunitiesTool: ToolConfig<
  AffinityListOpportunitiesParams,
  AffinityCollectionResponse<'opportunities'>
> = {
  id: 'affinity_list_opportunities',
  name: 'Affinity List Opportunities',
  description:
    'Page through opportunities. Field data lives on the list entry, not here — read it through the list or saved view the opportunity belongs to.',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.ERRORS_ARRAY_STRING,

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Affinity API key, sent as a bearer token',
    },
    ids: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Restrict the page to these opportunity IDs, e.g. [1, 2, 3]',
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
      buildAffinityUrl('/opportunities', {
        ids: parseNumberList(params.ids, 'ids'),
        cursor: params.cursor,
        limit: params.limit,
      }),
    method: 'GET',
    headers: (params) => affinityHeaders(params.apiKey),
  },

  transformResponse: transformCollection('opportunities'),

  outputs: {
    opportunities: {
      type: 'array',
      description: 'Opportunities the caller can view',
      items: { type: 'object', properties: OPPORTUNITY_OUTPUT_PROPERTIES },
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
