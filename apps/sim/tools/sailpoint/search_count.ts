import {
  SAILPOINT_QUERY_ROUTE,
  sailpointCountOutputs,
  sailpointCredentialParams,
  unwrapSailPointOutput,
} from '@/tools/sailpoint/common'
import type { SailPointCountResponse, SailPointSearchCountParams } from '@/tools/sailpoint/types'
import type { ToolConfig } from '@/tools/types'

export const sailpointSearchCountTool: ToolConfig<
  SailPointSearchCountParams,
  SailPointCountResponse
> = {
  id: 'sailpoint_search_count',
  name: 'SailPoint Search Count',
  description:
    'Return the total number of documents matching a SailPoint search query, without the documents themselves.',
  version: '1.0.0',

  params: {
    ...sailpointCredentialParams,
    indices: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'Indices to search (defaults to ["identities"])',
    },
    query: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Elasticsearch query string',
    },
  },

  request: {
    url: SAILPOINT_QUERY_ROUTE,
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      operation: 'sailpoint_search_count',
      clientId: params.clientId,
      clientSecret: params.clientSecret,
      tenant: params.tenant,
      apiVersion: params.apiVersion,
      indices: params.indices,
      query: params.query,
    }),
  },

  transformResponse: (response) => unwrapSailPointOutput<{ total: number }>(response),

  outputs: sailpointCountOutputs,
}
