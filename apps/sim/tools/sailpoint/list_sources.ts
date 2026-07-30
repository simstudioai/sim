import {
  SAILPOINT_QUERY_ROUTE,
  sailpointCredentialParams,
  sailpointListOutputs,
  sailpointPaginationParams,
  unwrapSailPointOutput,
} from '@/tools/sailpoint/common'
import type {
  SailPointListOutput,
  SailPointListResponse,
  SailPointListSourcesParams,
} from '@/tools/sailpoint/types'
import type { ToolConfig } from '@/tools/types'

export const sailpointListSourcesTool: ToolConfig<
  SailPointListSourcesParams,
  SailPointListResponse
> = {
  id: 'sailpoint_list_sources',
  name: 'SailPoint List Sources',
  description: 'List identity sources in SailPoint with optional filters, sorters, and pagination.',
  version: '1.0.0',

  params: {
    ...sailpointCredentialParams,
    filters: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'SailPoint filter expression to narrow results',
    },
    sorters: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'SailPoint sorters expression',
    },
    forSubadmin: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return only sources the given source sub-admin identity can administer',
    },
    includeIDNSource: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Include the built-in IdentityNow source in results',
    },
    ...sailpointPaginationParams,
  },

  request: {
    url: SAILPOINT_QUERY_ROUTE,
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      operation: 'sailpoint_list_sources',
      clientId: params.clientId,
      clientSecret: params.clientSecret,
      tenant: params.tenant,
      apiVersion: params.apiVersion,
      filters: params.filters,
      sorters: params.sorters,
      forSubadmin: params.forSubadmin,
      includeIDNSource: params.includeIDNSource,
      limit: params.limit,
      offset: params.offset,
      count: params.count,
    }),
  },

  transformResponse: (response) => unwrapSailPointOutput<SailPointListOutput>(response),

  outputs: sailpointListOutputs,
}
