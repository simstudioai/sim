import {
  SAILPOINT_QUERY_ROUTE,
  sailpointCredentialParams,
  sailpointListOutputs,
  sailpointPaginationParams,
  unwrapSailPointOutput,
} from '@/tools/sailpoint/common'
import type {
  SailPointListIdentitiesParams,
  SailPointListOutput,
  SailPointListResponse,
} from '@/tools/sailpoint/types'
import type { ToolConfig } from '@/tools/types'

export const sailpointListIdentitiesTool: ToolConfig<
  SailPointListIdentitiesParams,
  SailPointListResponse
> = {
  id: 'sailpoint_list_identities',
  name: 'SailPoint List Identities',
  description:
    'List identities in SailPoint with optional Sailpoint filters, sorters, and pagination.',
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
    defaultFilter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'CORRELATED_ONLY (default) or NONE',
    },
    ...sailpointPaginationParams,
  },

  request: {
    url: SAILPOINT_QUERY_ROUTE,
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      operation: 'sailpoint_list_identities',
      clientId: params.clientId,
      clientSecret: params.clientSecret,
      tenant: params.tenant,
      apiVersion: params.apiVersion,
      filters: params.filters,
      sorters: params.sorters,
      defaultFilter: params.defaultFilter,
      limit: params.limit,
      offset: params.offset,
      count: params.count,
    }),
  },

  transformResponse: (response) => unwrapSailPointOutput<SailPointListOutput>(response),

  outputs: sailpointListOutputs,
}
