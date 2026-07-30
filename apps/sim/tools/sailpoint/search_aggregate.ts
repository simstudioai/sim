import {
  SAILPOINT_QUERY_ROUTE,
  sailpointCredentialParams,
  sailpointItemOutputs,
  unwrapSailPointOutput,
} from '@/tools/sailpoint/common'
import type { SailPointItemResponse, SailPointSearchAggregateParams } from '@/tools/sailpoint/types'
import type { ToolConfig } from '@/tools/types'

export const sailpointSearchAggregateTool: ToolConfig<
  SailPointSearchAggregateParams,
  SailPointItemResponse
> = {
  id: 'sailpoint_search_aggregate',
  name: 'SailPoint Search Aggregate',
  description:
    'Return the aggregation result (buckets under `aggregations`, plus `hits`) for a SailPoint search query.',
  version: '1.0.0',

  params: {
    ...sailpointCredentialParams,
    indices: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Indices to aggregate over (defaults to ["identities"])',
    },
    query: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Elasticsearch query string to scope the documents before aggregating',
    },
    aggregationsDsl: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Elasticsearch aggregations DSL object defining the buckets/metrics to compute, e.g. { "department": { "terms": { "field": "attributes.department" } } }',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of aggregation results (max 250)',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination offset (0-based)',
    },
  },

  request: {
    url: SAILPOINT_QUERY_ROUTE,
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      operation: 'sailpoint_search_aggregate',
      clientId: params.clientId,
      clientSecret: params.clientSecret,
      tenant: params.tenant,
      apiVersion: params.apiVersion,
      indices: params.indices,
      query: params.query,
      aggregationsDsl: params.aggregationsDsl,
      limit: params.limit,
      offset: params.offset,
    }),
  },

  transformResponse: (response) => unwrapSailPointOutput<{ item: unknown }>(response),

  outputs: sailpointItemOutputs,
}
